import { auth } from "../../../../../auth";
import { acceptRunnerMission, markOrderDelivered, reportDeliveryIssue, reportSourcing, startOrderDelivery } from "../../../../../lib/orders/runner-service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "RUNNER") return Response.json({ error: "Runner access required." }, { status: 403 });
  const { id: orderId } = await context.params;
  try {
    const body = await request.json();
    if (body?.action === "accept") return Response.json(await acceptRunnerMission(session.user.id, orderId));
    if (body?.action === "source") {
      if (typeof body.orderItemId !== "string" || typeof body.vendorId !== "string" || !["AVAILABLE", "UNAVAILABLE"].includes(body.result)) {
        return Response.json({ error: "Sourcing update is incomplete." }, { status: 400 });
      }
      return Response.json(await reportSourcing(session.user.id, orderId, {
        orderItemId: body.orderItemId,
        vendorId: body.vendorId,
        result: body.result,
        quantity: body.quantity,
        actualUnitPrice: body.actualUnitPrice,
      }));
    }
    if (body?.action === "start-delivery") return Response.json(await startOrderDelivery(session.user.id, orderId));
    if (body?.action === "delivered") return Response.json(await markOrderDelivered(session.user.id, orderId));
    if (body?.action === "delivery-issue") {
      const allowed = ["CUSTOMER_UNAVAILABLE", "DELIVERY_ISSUE", "WRONG_ITEM", "MISSING_ITEM", "DAMAGED_ITEM", "OTHER"] as const;
      if (!allowed.includes(body.type) || typeof body.description !== "string" || body.description.length > 1000) {
        return Response.json({ error: "Choose an issue type and enter a short note." }, { status: 400 });
      }
      return Response.json(await reportDeliveryIssue(session.user.id, orderId, body.type, body.description));
    }
    return Response.json({ error: "Unknown mission action." }, { status: 400 });
  } catch (error) {
    console.error("RUNNER ORDER ACTION ERROR:", error instanceof Error ? error.name : "Unknown error");
    const message = error instanceof Error && /mission|order|runner|price|source|available|quantity|sourcing|accepted|active|verified|expired/i.test(error.message)
      ? error.message
      : "Unable to update this mission. Try again.";
    return Response.json({ error: message }, { status: 409 });
  }
}
