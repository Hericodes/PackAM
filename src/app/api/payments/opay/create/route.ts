import { PaymentProvider } from "@prisma/client";
import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { createPaymentAttempt } from "../../../../../lib/payments/payment-lifecycle";
import { createCashierPayment } from "../../../../../lib/payments/providers/opay";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only students can pay for a PackAM order." }, { status: 403 });
  const rate = await consumeRateLimit(`opay-create:${session.user.id}`, 5, 10 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Please wait a little before trying payment again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const idempotencyKey = request.headers.get("Idempotency-Key");
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Choose a delivery location to continue." }, { status: 400 }); }
  const deliveryLocationId = body && typeof body === "object" && "deliveryLocationId" in body
    ? (body as { deliveryLocationId?: unknown }).deliveryLocationId
    : undefined;
  const deliveryInstructions = body && typeof body === "object" && "deliveryInstructions" in body
    ? (body as { deliveryInstructions?: unknown }).deliveryInstructions
    : undefined;
  if (typeof deliveryLocationId !== "string" || !deliveryLocationId || !idempotencyKey) {
    return Response.json({ error: "Choose a delivery location to continue." }, { status: 400 });
  }
  if (deliveryInstructions !== undefined && (typeof deliveryInstructions !== "string" || deliveryInstructions.length > 500)) {
    return Response.json({ error: "Delivery instructions must be 500 characters or fewer." }, { status: 400 });
  }

  try {
    const attempt = await createPaymentAttempt(PaymentProvider.OPAY, deliveryLocationId, idempotencyKey, typeof deliveryInstructions === "string" ? deliveryInstructions.trim() || null : undefined);
    if (attempt.provider !== PaymentProvider.OPAY) throw new Error("Payment attempt provider mismatch.");
    if (attempt.status === "SUCCESS" || attempt.status === "FAILED") {
      return Response.json({ error: "Start a new payment attempt from checkout." }, { status: 409 });
    }
    const stored = await db.payment.findUnique({
      where: { transactionReference: attempt.transactionReference! },
      select: { cashierUrl: true, providerCheckoutReference: true, checkoutSnapshot: true },
    });
    if (stored?.cashierUrl) return Response.json({ cashierUrl: stored.cashierUrl });

    const [student, appUrl] = await Promise.all([
      db.user.findUnique({ where: { id: session.user.id }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } }),
      Promise.resolve(process.env.APP_URL),
    ]);
    if (!student) throw new Error("Authenticated student account not found.");
    if (!appUrl) throw new Error("APP_URL is required for OPay return and callback URLs.");
    const baseUrl = new URL(appUrl);
    if (baseUrl.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("APP_URL must use HTTPS in production.");
    const reference = attempt.transactionReference!;
    const snapshot = stored?.checkoutSnapshot as { items?: { productName: string; quantity: number }[] } | null;
    const description = snapshot?.items?.map((item) => `${item.productName} × ${item.quantity}`).join(", ") || "PackAM campus order";
    const result = await createCashierPayment({
      reference,
      amount: attempt.amount,
      productDescription: description,
      customer: {
        id: student.id,
        name: [student.firstName, student.lastName].filter(Boolean).join(" "),
        email: student.email,
        phone: student.phone ?? undefined,
      },
      returnUrl: new URL(`/checkout/payment-result?reference=${encodeURIComponent(reference)}`, baseUrl).toString(),
      cancelUrl: new URL(`/checkout/payment-result?reference=${encodeURIComponent(reference)}`, baseUrl).toString(),
      callbackUrl: new URL("/api/webhooks/opay", baseUrl).toString(),
    });
    await db.payment.update({
      where: { transactionReference: reference },
      data: { cashierUrl: result.cashierUrl, providerCheckoutReference: result.providerCheckoutReference },
    });
    return Response.json({ cashierUrl: result.cashierUrl });
  } catch (error) {
    console.error("OPAY PAYMENT CREATE ERROR:", error instanceof Error ? error.name : "Unknown error");
    const message = error instanceof Error && /cart is empty|delivery location|no longer available|invalid quantity|not active/i.test(error.message)
      ? error.message
      : "We couldn't start your payment. Your cart is safe. Please try again.";
    return Response.json({ error: message }, { status: 400 });
  }
}
