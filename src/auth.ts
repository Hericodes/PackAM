import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";

import { db } from "./lib/db";
import { consumeRateLimit } from "./lib/rate-limit";

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

        const normalizedIdentifier = identifier.trim().toLowerCase();
        const address = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        const fingerprint = createHash("sha256").update(`${address}:${normalizedIdentifier}`).digest("hex");
        const loginLimit = await consumeRateLimit(`login:${fingerprint}`, 8, 15 * 60 * 1000);
        if (!loginLimit.allowed) return null;

        const user = await db.user.findFirst({
          where: {
            OR: [
              {
                email: normalizedIdentifier,
              },
              {
                phone: identifier,
              },
            ],
          },
        });

        if (!user || !user.passwordHash) {
          // Keep invalid-user and invalid-password paths closer in timing.
          await bcrypt.compare(password, "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6Q/JZjNH29/SK3Gm9z4kKMVd7Bu2G");
          return null;
        }

        if (user.status !== "ACTIVE") {
          return null;
        }

        const passwordMatches = await bcrypt.compare(
          password,
          user.passwordHash
        );

        if (!passwordMatches) {
          return null;
        }

        return {
          id: user.id,
          name:
            [user.firstName, user.lastName]
              .filter(Boolean)
              .join(" ") || null,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.authRevoked = false;
      } else if (typeof token.id === "string") {
        const current = await db.user.findFirst({ where: { id: token.id, status: "ACTIVE" }, select: { id: true, role: true } });
        if (!current) {
          token.authRevoked = true;
          delete token.id;
          delete token.role;
        } else {
          token.role = current.role;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (token.authRevoked) {
        delete session.user;
        return session;
      }
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as
          | "STUDENT"
          | "RUNNER"
          | "ADMIN";
      }

      return session;
    },
  },
});
