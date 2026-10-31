import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../../lib/db-errors";
import { nameProblem, normaliseName } from "../../../../lib/account/validation";
import { rejectCrossSite, requireJson } from "../../../../lib/request-guards";

/**
 * Changes the signed-in person's first and last name (every role), checked like sign-up. The audit row records
 * which names changed, never the names themselves. Answers { firstName, lastName } as stored.
 */
export async function PATCH(request: Request) {
  const blocked = rejectCrossSite(request) ?? requireJson(request);
  if (blocked) return blocked;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return signInRequired();
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "PackAM couldn’t read that request. Refresh the page and try again.", code: "INVALID_REQUEST" }, { status: 400 });

  const problems = { firstName: nameProblem(body.firstName, "first name"), lastName: nameProblem(body.lastName, "last name") };
  if (problems.firstName || problems.lastName) {
    const fields = Object.fromEntries(Object.entries(problems).filter(([, problem]) => problem !== null));
    return Response.json({ error: problems.firstName ?? problems.lastName, code: "INVALID_NAME", fields }, { status: 400 });
  }
  const firstName = normaliseName(body.firstName);
  const lastName = normaliseName(body.lastName);

  try {
    const saved = await db.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true } });
      if (!user) return false;
      const changed = [user.firstName !== firstName ? "firstName" : null, user.lastName !== lastName ? "lastName" : null].filter((field) => field !== null);
      if (!changed.length) return true;
      // Guarded on ACTIVE, so a name can't be written back onto an account deleted meanwhile.
      const updated = await tx.user.updateMany({ where: { id: user.id, status: "ACTIVE" }, data: { firstName, lastName } });
      if (updated.count !== 1) return false;
      await writeAuditLog(tx, { actorId: user.id, action: "ACCOUNT_PROFILE_UPDATED", resource: "User", resourceId: user.id, newState: { changed } });
      return true;
    });
    if (!saved) return signInRequired();
    return Response.json({ firstName, lastName });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "PATCH /api/account/profile");
    console.error("ACCOUNT PROFILE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t save your name. Nothing has changed. Please try again." }, { status: 500 });
  }
}

function signInRequired() {
  return Response.json({ error: "Sign in to update your profile.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
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
