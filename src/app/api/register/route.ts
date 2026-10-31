import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";

import { db } from "../../../lib/db";
import { afterResponse } from "../../../lib/after-response";
import { appUrl } from "../../../lib/app-url";
import { isSchemaBehindCode, missingSchemaElement, schemaBehindCodeResponse } from "../../../lib/db-errors";
import { isEmailConfigured, sendEmail } from "../../../lib/email";
import { verifyEmail } from "../../../lib/email/templates";
import { issueAccountToken } from "../../../lib/account/account-tokens";
import { passwordProblem } from "../../../lib/account/password-policy";
import { isValidEmail, nameProblem, normaliseEmail, normaliseName, normalisePhone, phoneProblem } from "../../../lib/account/validation";
import { clientAddress, consumeRateLimit } from "../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../lib/request-guards";

const HOUR_MS = 60 * 60 * 1000;
/** Per network. Only complete, valid details count, so a typo the form missed doesn't use one up. */
const SIGN_UPS_PER_ADDRESS_PER_HOUR = 5;

const EMAIL_TAKEN = "An account with this email already exists.";
const PHONE_TAKEN = "An account with this phone number already exists.";

type Field = "firstName" | "lastName" | "email" | "phone" | "password";
/** What became of the new account's confirmation email; see sendConfirmationLink(). */
type VerificationEmail = "sent" | "not-configured" | "failed";

/**
 * Sign-up: { firstName, lastName, email, phone, password }. Creates an ACTIVE STUDENT (the role never comes from the
 * request) with an empty StudentProfile and Cart in one transaction, then emails a 24-hour link to confirm the
 * address. The browser signs itself in afterwards (next-auth/react) with the password it just sent. Details are
 * checked exactly as the form checks them (src/lib/account/validation.ts and password-policy.ts); the email is stored
 * trimmed and lowercased and the phone trimmed, the way login looks them up.
 *
 * 201 { success: true, message, verificationEmail }. Refusals are { success: false, message, code }: 400
 * INVALID_REQUEST (unreadable body) or INVALID_DETAILS (with `fields`, the problem with each field; `message` is the
 * first); 409 EMAIL_TAKEN or PHONE_TAKEN, also when two sign-ups race for the same address; 429 RATE_LIMITED
 * (Retry-After and retryAfterSeconds). The request guards answer 403 and 415 before anything else runs.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;

  const body = await readJsonObject(request);
  if (!body) return failure(400, "PackAM couldn’t read that request. Refresh the page and try again.", "INVALID_REQUEST");

  const firstName = normaliseName(body.firstName);
  const lastName = normaliseName(body.lastName);
  const email = normaliseEmail(body.email);
  const phone = normalisePhone(body.phone);
  const fields = problemsWith(body, { firstName, lastName, email });
  const firstProblem = Object.values(fields)[0];
  if (firstProblem) return Response.json({ success: false, message: firstProblem, code: "INVALID_DETAILS", fields }, { status: 400 });
  // Used exactly as sent: passwordProblem() has just accepted it as it is.
  const password = typeof body.password === "string" ? body.password : "";

  try {
    const rate = await consumeRateLimit(`register:${clientAddress(request)}`, SIGN_UPS_PER_ADDRESS_PER_HOUR, HOUR_MS);
    if (!rate.allowed) {
      return Response.json(
        { success: false, message: "Too many attempts. Please try again later.", code: "RATE_LIMITED", retryAfterSeconds: rate.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const taken = await alreadyTaken(email, phone);
    if (taken) return taken;

    const passwordHash = await bcrypt.hash(password, 12);
    let userId: string;
    try {
      userId = await db.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            firstName,
            lastName,
            email,
            phone,
            passwordHash,

            // Registration is always for students.
            // Users cannot choose their own role.
            role: "STUDENT",

            status: "ACTIVE",

            studentProfile: {
              create: {},
            },

            carts: {
              create: {},
            },
          },
          select: { id: true },
        });
        return user.id;
      });
    } catch (error) {
      // Another sign-up took the email or phone between the check above and this insert (two taps, two tabs):
      // nothing was created, so answer the way the check would have.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const conflict = await alreadyTaken(email, phone);
        if (conflict) return conflict;
      }
      throw error;
    }

    const verificationEmail = await sendConfirmationLink({ id: userId, email, firstName });
    return Response.json({ success: true, message: "Your PackAM account has been created.", verificationEmail }, { status: 201 });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "registration");
    console.error("REGISTRATION ERROR:", error instanceof Error ? error.name : "Unknown error");
    return failure(500, "Something went wrong while creating your account. Please try again.");
  }
}

/** The problem with each field, in the form's order, in the form's words; empty when everything can be used. */
function problemsWith(body: Record<string, unknown>, account: { firstName: string; lastName: string; email: string }) {
  const checks: Array<[Field, string | null]> = [
    ["firstName", nameProblem(body.firstName, "first name")],
    ["lastName", nameProblem(body.lastName, "last name")],
    ["email", !account.email ? "Enter your email address." : isValidEmail(account.email) ? null : "Enter a valid email address, like you@example.com."],
    ["phone", phoneProblem(body.phone)],
    ["password", passwordProblem(body.password, { email: account.email, names: [account.firstName, account.lastName] })],
  ];
  return Object.fromEntries(checks.filter((check): check is [Field, string] => check[1] !== null)) as Partial<Record<Field, string>>;
}

/** 409 when another account already has this email or phone number (the email is named first), otherwise null. */
async function alreadyTaken(email: string, phone: string) {
  const owners = await db.user.findMany({ where: { OR: [{ email }, { phone }] }, select: { email: true }, take: 2 });
  if (owners.some((owner) => owner.email === email)) return failure(409, EMAIL_TAKEN, "EMAIL_TAKEN");
  return owners.length > 0 ? failure(409, PHONE_TAKEN, "PHONE_TAKEN") : null;
}

/**
 * The new account's first confirmation link, emailed after the response so a slow provider never holds sign-up up.
 * The account stands whatever happens here; a new link can be sent from Settings.
 * - "not-configured": PackAM can't send email (or build links), so no link is made.
 * - "failed": the link couldn't be made, or the email couldn't be sent.
 * - "sent": the email is on its way. It goes after the response, so a provider failure then is only logged (by
 *   purpose, never the address). Without a request scope (database tests) it has already gone by the time this
 *   answers, and this reports how that went.
 */
async function sendConfirmationLink(account: { id: string; email: string; firstName: string }): Promise<VerificationEmail> {
  if (!canEmailLinks()) return "not-configured";
  try {
    const token = await db.$transaction((tx) => issueAccountToken(tx, { userId: account.id, purpose: "EMAIL_VERIFICATION", email: account.email }));
    const message = verifyEmail(account.firstName, appUrl(`/api/account/verify-email?token=${token}`));
    const delivery: { status: VerificationEmail } = { status: "sent" };
    await afterResponse(async () => {
      delivery.status = (await sendEmail({ to: account.email, purpose: "email-verification", ...message })).status;
    });
    return delivery.status;
  } catch (error) {
    if (isSchemaBehindCode(error)) {
      console.error(`SCHEMA BEHIND CODE in registration: the database is missing ${missingSchemaElement(error)}. Apply the pending Prisma migrations (npx prisma migrate deploy) to this database.`);
    } else {
      console.error("REGISTRATION EMAIL ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
    return "failed";
  }
}

/** Email can go out and links can be built (APP_URL is usable). */
function canEmailLinks() {
  if (!isEmailConfigured()) return false;
  try {
    appUrl("/api/account/verify-email");
    return true;
  } catch (error) {
    console.error("REGISTRATION EMAIL ERROR:", error instanceof Error ? error.name : "Unknown error");
    return false;
  }
}

function failure(status: number, message: string, code?: string) {
  return Response.json({ success: false, message, ...(code ? { code } : {}) }, { status });
}

/** The JSON body when it is an object, otherwise null (malformed JSON, an array, a string). */
async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
