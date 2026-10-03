import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { setRunnerAvailability } from "../../../../lib/orders/runner-service";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to update availability." }, { status: 401 });
  if (session.user.role !== "RUNNER") return Response.json({ error: "Runner access required." }, { status: 403 });
  try {
    const body = await request.json();
    if (typeof body?.available !== "boolean") return Response.json({ error: "Choose available or unavailable." }, { status: 400 });
    const result = await setRunnerAvailability(session.user.id, body.available);
    return Response.json(result);
  } catch (error) {
    console.error("RUNNER AVAILABILITY ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Unable to update availability." }, { status: 400 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user || !["RUNNER", "ADMIN"].includes(session.user.role)) return Response.json({ error: "Runner access required." }, { status: 403 });
  if (session.user.role === "ADMIN") return Response.json({ isAvailable: false, isVerified: true, adminView: true });
  const runner = await db.runnerProfile.findUnique({ where: { userId: session.user.id }, select: { isAvailable: true, isVerified: true } });
  if (!runner) return Response.json({ error: "Runner profile not found." }, { status: 404 });
  return Response.json(runner);
}
