import { describeDetails, parseLineDetails } from "../../../../../lib/food/plate";
import { optionsText } from "../../../../../lib/products/variants";
import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { deliveryPointFromSnapshot, mapsLink } from "../../../../../lib/delivery-location";
import { loadOrderDeliveryTiers, runnerMissionLoad } from "../../../../../lib/delivery-tier-store";
import { decideTierAcceptance, describeOrderDelivery, idleRunnerRuleApplies } from "../../../../../lib/delivery-tiers";

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
          findingRunnerAt: true,
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
  // The delivery speed comes from its own query (never the order select), so this works before the tier migration.
  const row = (await loadOrderDeliveryTiers(db, [order.id])).get(order.id);
  const delivery = describeOrderDelivery(row);
  let acceptance: { allowed: boolean; reason: string | null } | undefined;
  if (assignment.status === "OFFERED") {
    // A hint for the Accept button; accepting checks the same rules again in its transaction.
    const load = await runnerMissionLoad(db, runner.id);
    const now = new Date();
    const decision = decideTierAcceptance({
      orderTier: row?.tier,
      activeMissions: load.activeMissions,
      holdsUrgent: load.holdsUrgent,
      idleRuleActive: idleRunnerRuleApplies({ tier: row?.tier, startedAt: order.findingRunnerAt ?? row?.createdAt ?? now, escalatedAt: row?.escalatedAt ?? null, now }),
    });
    acceptance = decision.ok ? { allowed: true, reason: null } : { allowed: false, reason: decision.message };
  }
  return Response.json({ mission: {
    assignmentStatus: assignment.status,
    id: order.id,
    status: order.status,
    delivery: { tier: delivery.tier, label: delivery.label, urgent: delivery.urgent, eta: delivery.etaShort, dueAt: delivery.dueAt?.toISOString() ?? null },
    ...(acceptance ? { acceptance } : {}),
    shop: order.shop,
    // A plate's base, soup and extras as one line, so the runner buys exactly what was paid for.
    items: order.items.map(({ details, ...item }) => { const parsed = parseLineDetails(details); return { ...item, plate: parsed && (parsed.kind === "PLATE" || parsed.pack) ? describeDetails(parsed) : null, options: optionsText(details) }; }),
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
