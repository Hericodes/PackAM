import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { loadOrderDeliveryTiers, type OrderDeliveryTierRow } from "../../../../lib/delivery-tier-store";
import { HOLDS_URGENT_MISSION_MESSAGE, decideTierAcceptance, describeOrderDelivery, idleRunnerRuleApplies, isUrgentTier } from "../../../../lib/delivery-tiers";
import { listActivePrintMissionsForAdmin, listRunnerPrintMissions } from "../../../../lib/printing/runner-service";
import { offerCutoff } from "../../../../lib/orders/dispatch-policy";
import { getRunnerAcceptanceTimeoutMinutes } from "../../../../lib/orders/price-policy";

/** The order's delivery speed for the board: "Standard delivery" when it has no tier row (paid before tiers). */
function deliveryView(row: OrderDeliveryTierRow | undefined) {
  const delivery = describeOrderDelivery(row);
  return { tier: delivery.tier, label: delivery.label, urgent: delivery.urgent, eta: delivery.etaShort, dueAt: delivery.dueAt?.toISOString() ?? null };
}

/**
 * The runner board. A runner (or an admin in runner mode) gets their own offers and deliveries. An admin asking for
 * `?view=all` gets every runner's open offers and deliveries instead (operations view, read-only).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || !["RUNNER", "ADMIN"].includes(session.user.role)) return Response.json({ error: "Runner access required." }, { status: 403 });
  if (session.user.role === "ADMIN" && new URL(request.url).searchParams.get("view") === "all") {
    const assignments = await db.runnerAssignment.findMany({
      where: { orderId: { not: null }, status: { in: ["OFFERED", "ACCEPTED"] }, order: { status: { in: ["FINDING_RUNNER", "RUNNER_ASSIGNED", "SOURCING_PRODUCT", "OUT_FOR_DELIVERY"] } } },
      orderBy: { offeredAt: "desc" }, take: 100,
      select: {
        id: true,
        status: true,
        order: { select: { id: true, status: true, findingRunnerAt: true, items: { select: { id: true, productName: true, quantity: true } }, deliveryAddress: true, deliveryLocation: { select: { label: true } } } },
      },
    });
    // Tier rows come from their own query (never through the order select), so this works before the tier migration.
    const tiers = await loadOrderDeliveryTiers(db, assignments.flatMap(({ order }) => (order ? [order.id] : [])));
    return Response.json({
      missions: assignments.flatMap(({ order, ...assignment }) => order ? [{ ...assignment, delivery: deliveryView(tiers.get(order.id)), order: { ...order, total: 0, deliveryLocationLabel: order.deliveryLocation?.label ?? "Campus delivery" } }] : []),
      printMissions: await listActivePrintMissionsForAdmin(),
      adminView: true,
    });
  }
  const runner = await db.runnerProfile.findFirst({
    where: { userId: session.user.id, isVerified: true, user: { status: "ACTIVE" } },
    select: { id: true },
  });
  // An admin who hasn't switched on runner mode yet has nothing to show (going available sets them up).
  if (!runner && session.user.role === "ADMIN") return Response.json({ missions: [], printMissions: [] });
  if (!runner) return Response.json({ error: "Your runner profile is not active and verified." }, { status: 403 });

  const assignments = await db.runnerAssignment.findMany({
    where: {
      runnerId: runner.id,
      orderId: { not: null },
      // Offers show only while they can still be accepted; expired ones are redispatched to others.
      OR: [
        { status: "OFFERED", offeredAt: { gte: offerCutoff(new Date(), getRunnerAcceptanceTimeoutMinutes()) }, order: { status: "FINDING_RUNNER", assignedRunnerId: null } },
        { status: "ACCEPTED" },
      ],
    },
    orderBy: { offeredAt: "desc" },
    select: {
      id: true,
      status: true,
      order: {
        select: {
          id: true,
          status: true,
          total: true,
          findingRunnerAt: true,
          deliveryAddress: true,
          deliveryInstructions: true,
          deliveryLocation: { select: { label: true } },
          items: { select: { id: true, productName: true, quantity: true } },
        },
      },
    },
  });
  const printMissions = await listRunnerPrintMissions(runner.id);
  const tiers = await loadOrderDeliveryTiers(db, assignments.flatMap(({ order }) => (order ? [order.id] : [])));
  // What the runner holds now decides which offers they can accept (the accept actions enforce the same rules).
  const acceptedOrders = assignments.filter((assignment) => assignment.status === "ACCEPTED" && assignment.order);
  const activeMissions = acceptedOrders.length + printMissions.filter((mission) => mission.assignmentStatus === "ACCEPTED").length;
  const holdsUrgent = acceptedOrders.some((assignment) => isUrgentTier(tiers.get(assignment.order!.id)?.tier));
  const now = new Date();
  return Response.json({
    printMissions: printMissions.map((mission) => mission.assignmentStatus === "OFFERED"
      ? { ...mission, acceptance: holdsUrgent ? { allowed: false, reason: HOLDS_URGENT_MISSION_MESSAGE } : { allowed: true, reason: null } }
      : mission),
    missions: assignments.flatMap(({ order, ...assignment }) => {
      if (!order) return [];
      const row = tiers.get(order.id);
      const decision = assignment.status === "OFFERED"
        ? decideTierAcceptance({
          orderTier: row?.tier,
          activeMissions,
          holdsUrgent,
          idleRuleActive: idleRunnerRuleApplies({ tier: row?.tier, startedAt: order.findingRunnerAt ?? row?.createdAt ?? now, escalatedAt: row?.escalatedAt ?? null, now }),
        })
        : null;
      return [{
        ...assignment,
        delivery: deliveryView(row),
        ...(decision ? { acceptance: decision.ok ? { allowed: true, reason: null } : { allowed: false, reason: decision.message } } : {}),
        order: {
          id: order.id,
          status: order.status,
          findingRunnerAt: order.findingRunnerAt,
          items: order.items,
          deliveryLocationLabel: order.deliveryLocation?.label ?? "Campus delivery",
          ...(assignment.status === "ACCEPTED" ? {
            deliveryAddress: order.deliveryAddress,
            deliveryInstructions: order.deliveryInstructions,
          } : {}),
        },
      }];
    }),
  });
}
