import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { setRunnerAvailability } from "../../../../lib/orders/runner-service";
import { runnerDashboardStatus } from "../../../../lib/runners/runner-access";
import { canDeliver } from "../../../../lib/orders/runner-offer-policy";

/**
 * Going available or offline. Runners need a profile operations set up and verified. Admins can deliver too
 * (runner mode, "Deliver orders"): the first time an admin goes available they get a runner profile, verified
 * straight away since admins are trusted, so offers reach them like any runner.
 */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to update availability." }, { status: 401 });
  if (!canDeliver(session.user.role)) return Response.json({ error: "Runner access required." }, { status: 403 });
  try {
    const body = await request.json();
    if (typeof body?.available !== "boolean") return Response.json({ error: "Choose available or unavailable." }, { status: 400 });
    if (session.user.role === "ADMIN") {
      await db.runnerProfile.upsert({ where: { userId: session.user.id }, create: { userId: session.user.id, isVerified: true, isAvailable: false }, update: { isVerified: true } });
    }
    const result = await setRunnerAvailability(session.user.id, body.available);
    return Response.json(result);
  } catch (error) {
    console.error("RUNNER AVAILABILITY ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Unable to update availability." }, { status: 400 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user || !canDeliver(session.user.role)) return Response.json({ error: "Runner access required." }, { status: 403 });
  const runner = await db.runnerProfile.findUnique({ where: { userId: session.user.id }, select: { isAvailable: true, isVerified: true } });
  // An admin who never switched on runner mode has no profile yet: offline, and ready to go available.
  if (session.user.role === "ADMIN") return Response.json({ isAvailable: runner?.isAvailable ?? false, isVerified: true, profileMissing: false, adminRunner: true });
  // A RUNNER account without a profile hasn't been set up by operations yet. That's a pending state, not
  // an error: report it (nothing is created here) so the dashboard can explain instead of failing.
  if (!runner) console.warn(JSON.stringify({ event: "runner_profile_missing", userIdTail: session.user.id.slice(-6) }));
  return Response.json(runnerDashboardStatus(runner));
}
