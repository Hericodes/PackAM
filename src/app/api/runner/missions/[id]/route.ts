import { describeDetails, parseLineDetails } from "../../../../../lib/food/plate";
import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { deliveryPointFromSnapshot, mapsLink } from "../../../../../lib/delivery-location";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "RUNNER") return Response.json({ error: "Runner access required." }, { status: 403 });
  const { id: orderId } = await context.params;
  const runner = await db.runnerProfile.findFirst({ where: { userId: session.user.id, isVerified: true, user: { status: "ACTIVE" } }, select: { id: true } });
  if (!runner) return Response.json({ error: "Your runner profile is not active and verified." }, { status: 403 });
  const assignment = await db.runnerAssignment.findFirst({
    where: { orderId, printJobId: null, runnerId: runner.id, status: { in: ["OFFERED", "ACCEPTED"] } },
    select: {
      status: true,
      order: {
        select: {
          id: true,
          status: true,
          total: true,
          deliveryAddress: true,
          deliveryInstructions: true,
          // Food orders: where to buy (name and location only, no internal vendor details).
          shop: { select: { id: true, name: true, location: true } },
          user: { select: { firstName: true, phone: true } },
          deliveryLocation: { select: { label: true, latitude: true, longitude: true } },
          payment: { select: { checkoutSnapshot: true } },
          items: {
            select: {
              id: true,
              productName: true,
              quantity: true,
              unitPrice: true,
              details: true,
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
  if (!assignment?.order) return Response.json({ error: "Mission not found." }, { status: 404 });
  const { order } = assignment;
  // Prefer the copy frozen at checkout; fall back to the saved location for orders placed before it existed.
  const frozen = deliveryPointFromSnapshot(order.payment?.checkoutSnapshot);
  const saved = order.deliveryLocation;
  const coordinates = frozen.coordinates ?? (saved?.latitude != null && saved?.longitude != null ? { latitude: saved.latitude, longitude: saved.longitude } : null);
  return Response.json({ mission: {
    assignmentStatus: assignment.status,
    id: order.id,
    status: order.status,
    shop: order.shop,
    // A plate's base, soup and extras as one line, so the runner buys exactly what was paid for.
    items: order.items.map(({ details, ...item }) => { const parsed = parseLineDetails(details); return { ...item, plate: parsed && parsed.kind === "PLATE" ? describeDetails(parsed) : null }; }),
    deliveryLocationLabel: frozen.label ?? saved?.label ?? "Campus delivery",
    ...(assignment.status === "ACCEPTED" ? {
      deliveryAddress: order.deliveryAddress,
      deliveryInstructions: order.deliveryInstructions,
      deliveryPoint: coordinates ? { ...coordinates, mapsUrl: mapsLink(coordinates) } : null,
      total: order.total,
      student: { firstName: order.user.firstName, phone: order.user.phone },
    } : {}),
  } });
}
