import bcrypt from "bcryptjs";

import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { afterResponse } from "../../../../lib/after-response";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../../lib/db-errors";
import { sendEmail } from "../../../../lib/email";
import { accountDeletedNotice } from "../../../../lib/email/templates";
import { deleteAccount, findDeletionBlockers, removeDeletedAccountDocuments } from "../../../../lib/account/deletion";
import { isDeleteConfirmation } from "../../../../lib/account/deletion-policy";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

/**
 * What would stop the signed-in student deleting their account right now: { blockers: [{ kind, message, count }] },
 * empty when nothing does. Lets settings say so before asking for a password; the POST re-checks everything.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return signInRequired();
  try {
    const user = await db.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true, role: true } });
    if (!user) return signInRequired();
    if (user.role !== "STUDENT") return studentsOnly();
    return Response.json({ blockers: await findDeletionBlockers(db, user.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "GET /api/account/delete");
    console.error("ACCOUNT DELETE CHECK ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t check your account right now. Please try again." }, { status: 500 });
  }
}

/**
 * Deletes the signed-in student's account: { currentPassword, confirm: "DELETE" }. Students only (403 otherwise).
 * 409 { blockers } while anything is in progress or money may be owed; otherwise the account is anonymised in place
 * (src/lib/account/deletion.ts), every device is signed out, and the old address gets a goodbye email. The browser
 * then signs out. 10 attempts an hour per account, wrong passwords included.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session?.user?.id) return signInRequired();
  const userId = session.user.id;
  if (session.user.role !== "STUDENT") return studentsOnly();
  const rate = await consumeRateLimit(`account-delete:${userId}`, 10, 60 * 60 * 1000);
  if (!rate.allowed) {
    return Response.json({ error: "Too many attempts. Please wait a while, then try again.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "PackAM couldn’t read that request. Refresh the page and try again.", code: "INVALID_REQUEST" }, { status: 400 });

  try {
    const user = await db.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true, role: true, passwordHash: true } });
    if (!user) return signInRequired();
    if (user.role !== "STUDENT") return studentsOnly();
    if (!isDeleteConfirmation(body.confirm)) return Response.json({ error: "Type DELETE to confirm.", code: "CONFIRMATION_REQUIRED" }, { status: 400 });
    if (!(await currentPasswordMatches(body.currentPassword, user.passwordHash))) {
      return Response.json({ error: "That isn’t your current password. Check it and try again.", code: "WRONG_PASSWORD" }, { status: 400 });
    }

    const result = await deleteAccount(user.id);
    if (result.kind === "BLOCKED") {
      return Response.json({ error: "You can’t delete your account just yet.", code: "DELETION_BLOCKED", blockers: result.blockers }, { status: 409 });
    }
    if (result.kind === "UNAVAILABLE") return signInRequired();

    await afterResponse(async () => {
      await sendEmail({ to: result.email, purpose: "account-deleted", ...accountDeletedNotice(result.firstName) });
    });
    await afterResponse(async () => {
      await removeDeletedAccountDocuments(user.id);
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "POST /api/account/delete");
    console.error("ACCOUNT DELETE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t delete your account. Nothing has changed. Please try again." }, { status: 500 });
  }
}

function signInRequired() {
  return Response.json({ error: "Sign in to manage your account.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
}

function studentsOnly() {
  return Response.json({ error: "Only student accounts can be deleted here. Contact PackAM support about your account.", code: "STUDENTS_ONLY" }, { status: 403 });
}

/** The current password exactly as typed: never trimmed or policy-checked, since older passwords weren't held to either. */
async function currentPasswordMatches(password: unknown, hash: string | null) {
  if (typeof password !== "string" || !password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/** The JSON body when it is an object, otherwise null. */
async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
