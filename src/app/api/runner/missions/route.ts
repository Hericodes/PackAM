import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user || !["RUNNER", "ADMIN"].includes(session.user.role)) return Response.json({ error: "Runner access required." }, { status: 403 });
  if (session.user.role === "ADMIN") {
    const assignments = await db.runnerAssignment.findMany({
      where: { status: { in: ["OFFERED", "ACCEPTED"] }, order: { status: { in: ["FINDING_RUNNER", "RUNNER_ASSIGNED", "SOURCING_PRODUCT", "OUT_FOR_DELIVERY"] } } },
      orderBy: { offeredAt: "desc" }, take: 100,
      select: {
        id: true,
        status: true,
        order: { select: { id: true, status: true, items: { select: { id: true, productName: true, quantity: true } }, deliveryAddress: true, deliveryLocation: { select: { label: true } } } },
      },
    });
    return Response.json({ missions: assignments.map(({ order, ...assignment }) => ({ ...assignment, order: { ...order, total: 0, deliveryLocationLabel: order.deliveryLocation?.label ?? "Campus delivery" } })), adminView: true });
  }
  const runner = await db.runnerProfile.findFirst({
    where: { userId: session.user.id, isVerified: true, user: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (!runner) return Response.json({ error: "Your runner profile is not active and verified." }, { status: 403 });

  const assignments = await db.runnerAssignment.findMany({
    where: { runnerId: runner.id, status: { in: ["OFFERED", "ACCEPTED"] } },
    orderBy: { offeredAt: "desc" },
    select: {
      id: true,
      status: true,
      order: {
        select: {
          id: true,
          status: true,
          total: true,
          deliveryAddress: true,
          deliveryInstructions: true,
          deliveryLocation: { select: { label: true } },
          items: { select: { id: true, productName: true, quantity: true } },
        },
      },
    },
  });
  return Response.json({ missions: assignments.map(({ order, ...assignment }) => ({
    ...assignment,
    order: {
      id: order.id,
      status: order.status,
      items: order.items,
      deliveryLocationLabel: order.deliveryLocation?.label ?? "Campus delivery",
      ...(assignment.status === "ACCEPTED" ? {
        deliveryAddress: order.deliveryAddress,
        deliveryInstructions: order.deliveryInstructions,
      } : {}),
    },
  })) });
}
