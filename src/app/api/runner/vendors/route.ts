import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { canDeliver } from "../../../../lib/orders/runner-offer-policy";

export async function GET() {
  const session = await auth();
  if (!session?.user || !canDeliver(session.user.role)) return Response.json({ error: "Runner access required." }, { status: 403 });
  const runner = await db.runnerProfile.findFirst({ where: { userId: session.user.id, isVerified: true, user: { status: "ACTIVE" } }, select: { id: true } });
  if (!runner) return Response.json({ error: "Verified runner profile required." }, { status: 403 });
  const vendors = await db.vendor.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, location: true } });
  return Response.json({ vendors });
}
