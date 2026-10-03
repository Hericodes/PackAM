import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "RUNNER") return Response.json({ error: "Runner access required." }, { status: 403 });
  const { id: orderId } = await context.params;
  const runner = await db.runnerProfile.findFirst({ where: { userId: session.user.id, isVerified: true, user: { status: "ACTIVE" } }, select: { id: true } });
  if (!runner) return Response.json({ error: "Your runner profile is not active and verified." }, { status: 403 });
  const assignment = await db.runnerAssignment.findFirst({
    where: { orderId, runnerId: runner.id, status: { in: ["OFFERED", "ACCEPTED"] } },
    select: {
      status: true,
      order: {
        select: {
          id: true,
          status: true,
          total: true,
          deliveryAddress: true,
          deliveryInstructions: true,
          user: { select: { firstName: true, phone: true } },
          deliveryLocation: { select: { label: true } },
          items: {
            select: {
              id: true,
              productName: true,
              quantity: true,
              unitPrice: true,
              sourcing: {
                select: {
                  id: true,
                  status: true,
                  quantity: true,
                  catalogueUnitPrice: true,
                  actualUnitPrice: true,
                  orderSource: { select: { vendor: { select: { name: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!assignment) return Response.json({ error: "Mission not found." }, { status: 404 });
  const { order } = assignment;
  return Response.json({ mission: {
    assignmentStatus: assignment.status,
    id: order.id,
    status: order.status,
    items: order.items,
    deliveryLocationLabel: order.deliveryLocation?.label ?? "Campus delivery",
    ...(assignment.status === "ACCEPTED" ? {
      deliveryAddress: order.deliveryAddress,
      deliveryInstructions: order.deliveryInstructions,
      total: order.total,
      student: { firstName: order.user.firstName, phone: order.user.phone },
    } : {}),
  } });
}
