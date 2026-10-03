import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { startRefundWorkflow } from "../../../../../lib/orders/refunds";
import { writeAuditLog } from "../../../../../lib/audit";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

type Context = { params: Promise<{ id: string }> };
export async function POST(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-refund:${session.user.id}`, 20, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many refund requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  try {
    const refund = await db.$transaction(async (tx) => {
      const previous = await tx.refund.findUnique({ where: { requestKey: `${id}:full` }, select: { id: true } });
      const refund = await startRefundWorkflow(tx, { orderId: id, actorId: session.user.id, reason: "ADMIN_REVIEW", note: "Operations initiated the refund workflow." });
      if (!previous) await writeAuditLog(tx, { actorId: session.user.id, action: "REFUND_INITIATED", resource: "Refund", resourceId: refund.id, newState: { amount: refund.amount, status: refund.status, orderId: id }, details: refund.reason });
      return refund;
    });
    return Response.json({ refund: { id: refund.id, status: refund.status } });
  } catch (error) {
    console.error("ADMIN REFUND WORKFLOW ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "A refund workflow could not be started for this order." }, { status: 409 });
  }
}
