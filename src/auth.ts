import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import type { Prisma, UserStatus } from "@prisma/client";

import { db } from "./lib/db";
import { isSchemaBehindCode, missingSchemaElement } from "./lib/db-errors";
import { clientAddress, consumeRateLimit } from "./lib/rate-limit";
import { LOGIN_ERROR_CODES } from "./lib/account/login-errors";
import { normaliseEmail, normalisePhone } from "./lib/account/validation";

type Role = "STUDENT" | "RUNNER" | "ADMIN";

/** Too many attempts from this address for this identifier. Says nothing about whether the account exists. */
class RateLimitedError extends CredentialsSignin {
  code = LOGIN_ERROR_CODES.rate_limited;
}

/** The password matched, but the account is suspended or deactivated: only someone who knows the password learns this. */
class AccountInactiveError extends CredentialsSignin {
  code = LOGIN_ERROR_CODES.inactive;
}

// Compared when there is no account or no password, so those answers take as long as a real check.
const DUMMY_HASH = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6Q/JZjNH29/SK3Gm9z4kKMVd7Bu2G";

// Explicit selects, so a new column only matters once this code reads it. The legacy ones (columns from before
// migration 20261101090000) keep login and sessions working if this code reaches a database not yet migrated.
const LEGACY_LOGIN_SELECT = { id: true, email: true, firstName: true, lastName: true, role: true, status: true, passwordHash: true } satisfies Prisma.UserSelect;
const LOGIN_SELECT = { ...LEGACY_LOGIN_SELECT, sessionVersion: true } satisfies Prisma.UserSelect;
const LEGACY_SESSION_SELECT = { id: true, email: true, firstName: true, lastName: true, role: true, status: true } satisfies Prisma.UserSelect;
const SESSION_SELECT = { ...LEGACY_SESSION_SELECT, sessionVersion: true, emailVerifiedAt: true } satisfies Prisma.UserSelect;

type SessionUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  status: UserStatus;
  sessionVersion: number;
  emailVerified: boolean;
};

let reportedSchemaLag = false;

/** Runs `query`; when the database is missing the new columns, says so once and runs `legacy` instead. */
async function withSchemaFallback<T>(query: () => Promise<T>, legacy: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    if (!reportedSchemaLag) {
      reportedSchemaLag = true;
      console.error(`SCHEMA BEHIND CODE in auth: the database is missing ${missingSchemaElement(error)}. Sign-in uses the older columns until the pending Prisma migrations are applied (npx prisma migrate deploy).`);
    }
    return legacy();
  }
}

/** The account for an email-or-phone identifier. An email match wins over a phone match, so row order never decides. */
async function findLoginUser(email: string, phone: string) {
  const where = { OR: [{ email }, { phone }] } satisfies Prisma.UserWhereInput;
  const matches = await withSchemaFallback(
    () => db.user.findMany({ where, select: LOGIN_SELECT, take: 2 }),
    async () => (await db.user.findMany({ where, select: LEGACY_LOGIN_SELECT, take: 2 })).map((user) => ({ ...user, sessionVersion: 0 })),
  );
  return matches.find((user) => user.email === email) ?? matches[0] ?? null;
}

/** The signed-in account as each request sees it: one primary-key read. */
function loadSessionUser(id: string) {
  return withSchemaFallback<SessionUser | null>(
    async () => {
      const user = await db.user.findUnique({ where: { id }, select: SESSION_SELECT });
      if (!user) return null;
      const { emailVerifiedAt, ...rest } = user;
      return { ...rest, emailVerified: emailVerifiedAt !== null };
    },
    async () => {
      const user = await db.user.findUnique({ where: { id }, select: LEGACY_SESSION_SELECT });
      return user && { ...user, sessionVersion: 0, emailVerified: false };
    },
  );
}

function displayName(user: { firstName: string | null; lastName: string | null }) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
  },

  pages: {
    signIn: "/login",
  },

  providers: [
    Credentials({
      name: "Credentials",

      credentials: {
        identifier: {
          label: "Email or Phone",
          type: "text",
          placeholder: "you@example.com",
        },

        password: {
          label: "Password",
          type: "password",
        },
      },

      async authorize(credentials, request) {
        const identifier = credentials?.identifier;
        const password = credentials?.password;

        if (
          typeof identifier !== "string" ||
          typeof password !== "string"
        ) {
          return null;
        }

        // Emails are stored trimmed and lowercased, phones trimmed. The password is used exactly as typed (no
        // trim, length cap or policy): existing passwords were never held to any of those.
        const email = normaliseEmail(identifier);
        const phone = normalisePhone(identifier);
        const fingerprint = createHash("sha256").update(`${clientAddress(request)}:${email}`).digest("hex");
        const loginLimit = await consumeRateLimit(`login:${fingerprint}`, 8, 15 * 60 * 1000);
        if (!loginLimit.allowed) throw new RateLimitedError();

        const user = phone ? await findLoginUser(email, phone) : null;

        if (!user?.passwordHash) {
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }

        // Checked before the status, so a suspended or deactivated account answers as slowly as any other.
        const passwordMatches = await bcrypt.compare(
          password,
          user.passwordHash
        );

        if (!passwordMatches) {
          return null;
        }

        if (user.status !== "ACTIVE") {
          throw new AccountInactiveError();
        }

        return {
          id: user.id,
          name: displayName(user),
          email: user.email,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Sign-in: the only place a session version is adopted, from the account authorize() just checked.
        token.id = user.id;
        token.role = user.role;
        token.sessionVersion = typeof user.sessionVersion === "number" ? user.sessionVersion : 0;
        return token;
      }

      // Every other call, whatever the trigger (including "update"): re-read the account and trust nothing the
      // caller sent. null ends the session: auth() returns null and the session endpoint clears the cookie.
      if (typeof token.id !== "string") return null;
      const current = await loadSessionUser(token.id);
      // Cookies issued before session versions existed carry none; they count as 0.
      const issuedVersion = typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
      if (!current || current.status !== "ACTIVE" || current.sessionVersion !== issuedVersion) return null;

      token.role = current.role;
      // Fresh on every request, so headers show a changed name or email straight away.
      token.name = displayName(current);
      token.email = current.email;
      token.emailVerified = current.emailVerified;
      // Revocation used to be a flag on the token; it is now always a null session.
      delete token.authRevoked;
      return token;
    },

    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.id as string,
          role: token.role as Role,
          emailVerified: token.emailVerified === true,
        },
      };
    },
  },
});
