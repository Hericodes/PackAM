import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { decidePriceChange } from "../../../../lib/orders/runner-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to view this order." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Student access required." }, { status: 403 });
  const { id } = await context.params;
  const order = await db.order.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      status: true,
      subtotal: true,
      deliveryFee: true,
      total: true,
      currency: true,
      deliveryAddress: true,
      deliveryInstructions: true,
      createdAt: true,
      deliveredAt: true,
      payment: { select: { status: true } },
      deliveryLocation: { select: { label: true } },
      items: { select: {
        id: true,
        productName: true,
        quantity: true,
        unitPrice: true,
        totalPrice: true,
        sourcing: { select: {
          id: true,
          status: true,
          quantity: true,
          catalogueUnitPrice: true,
          actualUnitPrice: true,
          autoApproved: true,
          priceDecisionAt: true,
          orderSource: { select: { vendor: { select: { name: true } } } },
        } },
      } },
      statusHistory: { orderBy: { createdAt: "asc" }, select: { status: true, note: true, createdAt: true } },
      assignedRunner: { select: { user: { select: { firstName: true } } } },
    },
  });
  if (!order) return Response.json({ error: "Order not found." }, { status: 404 });
  return Response.json({ order });
}

export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Student access required." }, { status: 403 });
  const { id: orderId } = await context.params;
  try {
    const body = await request.json();
    if (body?.action !== "price-decision" || typeof body.sourcingId !== "string" || !["CONTINUE", "CANCEL"].includes(body.decision)) {
      return Response.json({ error: "Price decision is incomplete." }, { status: 400 });
    }
    const result = await decidePriceChange(session.user.id, orderId, body.sourcingId, body.decision);
    return Response.json(result);
  } catch (error) {
    console.error("STUDENT ORDER ACTION ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Unable to save this decision." }, { status: 409 });
  }
}
