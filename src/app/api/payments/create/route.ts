import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { createPaymentAttempt } from "../../../../lib/payments/payment-lifecycle";
import { checkoutProvider, createHostedCheckout } from "../../../../lib/payments/gateways";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { CartNotPayableError, CheckoutAttemptMismatchError, DeliveryTierUnavailableError, PriceChangedError } from "../../../../lib/payments/payment-errors";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../../lib/db-errors";
import { parseCheckoutDeliveryRequest } from "../../../../lib/delivery-tiers";
import { manualTransferAccount } from "../../../../lib/payments/manual-transfer";
import { ensureManualCheckout } from "../../../../lib/payments/manual-transfer-store";
import { OrderingClosedError, orderingClosedBody } from "../../../../lib/ordering-hours";
import { OutsideServiceAreaError } from "../../../../lib/service-area";
import { PromoCodeRejectedError } from "../../../../lib/promo/promo-rules";
import { parseCartSection } from "../../../../lib/food/cart-context";

/**
 * Starts (or resumes) payment for the student's current cart. New attempts use the active provider
 * (PAYMENT_PROVIDER); an attempt reused through its idempotency key keeps the provider it was created
 * with, so one attempt never has two checkouts. The browser sends only the delivery speed (deliveryTier;
 * none means Cruise Mode) and the fee it showed (reviewedDeliveryFee); the fee charged is the server's.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only students can pay for a PackAM order." }, { status: 403 });
  const rate = await consumeRateLimit(`opay-create:${session.user.id}`, 5, 10 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Please wait a little before trying payment again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const idempotencyKey = request.headers.get("Idempotency-Key");
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Choose a delivery location to continue." }, { status: 400 }); }
  const deliveryLocationId = body && typeof body === "object" && "deliveryLocationId" in body ? (body as { deliveryLocationId?: unknown }).deliveryLocationId : undefined;
  const deliveryInstructions = body && typeof body === "object" && "deliveryInstructions" in body ? (body as { deliveryInstructions?: unknown }).deliveryInstructions : undefined;
  if (typeof deliveryLocationId !== "string" || !deliveryLocationId || !idempotencyKey) {
    return Response.json({ error: "Choose a delivery location to continue." }, { status: 400 });
  }
  if (deliveryInstructions !== undefined && (typeof deliveryInstructions !== "string" || deliveryInstructions.length > 500)) {
    return Response.json({ error: "Delivery instructions must be 500 characters or fewer." }, { status: 400 });
  }
  // The total the student last reviewed. Only compared with the server's own total, never charged.
  const reviewedTotal = body && typeof body === "object" && "reviewedTotal" in body ? (body as { reviewedTotal?: unknown }).reviewedTotal : undefined;
  if (typeof reviewedTotal !== "number" || !Number.isSafeInteger(reviewedTotal) || reviewedTotal < 0) {
    return Response.json({ error: "Refresh checkout to see your total, then pay." }, { status: 400 });
  }
  // The delivery speed, and the fee the student saw for it (compared, never charged). No money field is read.
  const delivery = parseCheckoutDeliveryRequest(body);
  if (!delivery.ok) return Response.json({ error: delivery.error, code: delivery.code }, { status: 400 });
  // An applied promo code: just the code. Its discount is decided again on the server, never read from the browser.
  const promoCode = body && typeof body === "object" && "promoCode" in body ? (body as { promoCode?: unknown }).promoCode : undefined;
  if (promoCode !== undefined && promoCode !== null && (typeof promoCode !== "string" || promoCode.length > 40)) {
    return Response.json({ error: "That promo code isn’t valid. Remove it and try again.", code: "PROMO_REJECTED" }, { status: 400 });
  }
  // Which cart this checkout pays for ("stuff" or "food"). Absent from tabs opened before the carts were separate.
  const rawSection = body && typeof body === "object" && "cart" in body ? (body as { cart?: unknown }).cart : undefined;
  const section = rawSection === undefined ? undefined : parseCartSection(rawSection);
  if (section === null) return Response.json({ error: "Refresh checkout, then pay." }, { status: 400 });
  // "Use my cashback": only the choice is sent; how much is worked out on the server from the balance.
  const useCashback = body && typeof body === "object" && "useCashback" in body ? (body as { useCashback?: unknown }).useCashback === true : false;

  // Bank transfer with no account set up: refuse before anything is created, so no student is sent to a blank account.
  const transferAccount = manualTransferAccount(process.env);
  if (checkoutProvider() === "MANUAL" && !transferAccount) {
    console.error("PAYMENT CREATE: PAYMENT_PROVIDER is MANUAL but MANUAL_TRANSFER_* is incomplete; refusing checkout.");
    return Response.json({ error: "Payment is unavailable right now. Your cart is safe. Please try again a little later." }, { status: 503 });
  }

  try {
    const attempt = await createPaymentAttempt(checkoutProvider(), deliveryLocationId, idempotencyKey, typeof deliveryInstructions === "string" ? deliveryInstructions.trim() || null : undefined, reviewedTotal, { tier: delivery.tier, reviewedDeliveryFee: delivery.reviewedDeliveryFee }, { code: typeof promoCode === "string" ? promoCode : null }, { section }, { use: useCashback });
    if (attempt.status === "SUCCESS" || attempt.status === "FAILED") {
      return Response.json({ error: "Start a new payment attempt from checkout." }, { status: 409 });
    }
    const stored = await db.payment.findUnique({
      where: { transactionReference: attempt.transactionReference! },
      select: { cashierUrl: true, checkoutSnapshot: true },
    });
    if (stored?.cashierUrl) return Response.json({ cashierUrl: stored.cashierUrl, provider: attempt.provider });
    // Bank transfer: no gateway. The student gets PackAM's own page with the account number and a transfer code.
    if (attempt.provider === "MANUAL") {
      if (!transferAccount) return Response.json({ error: "Payment is unavailable right now. Your cart is safe. Please try again a little later." }, { status: 503 });
      return Response.json({ cashierUrl: await ensureManualCheckout(attempt.transactionReference!), provider: attempt.provider });
    }

    const [student, appUrl] = await Promise.all([
      db.user.findUnique({ where: { id: session.user.id }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } }),
      Promise.resolve(process.env.APP_URL),
    ]);
    if (!student) throw new Error("Authenticated student account not found.");
    if (!appUrl) throw new Error("APP_URL is required for payment return and webhook URLs.");
    const baseUrl = new URL(appUrl);
    if (baseUrl.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("APP_URL must use HTTPS in production.");
    const reference = attempt.transactionReference!;
    const snapshot = stored?.checkoutSnapshot as { items?: { productName: string; quantity: number }[] } | null;
    const description = snapshot?.items?.map((item) => `${item.productName} × ${item.quantity}`).join(", ") || "PackAM campus order";
    const checkout = await createHostedCheckout(attempt.provider, {
      reference,
      amount: attempt.amount,
      productName: "PackAM campus order",
      description,
      customer: { id: student.id, name: [student.firstName, student.lastName].filter(Boolean).join(" "), email: student.email, phone: student.phone ?? undefined },
      returnPath: "/checkout/payment-result",
      returnQuery: { reference },
      baseUrl,
      metadata: { packamReference: reference, kind: "MARKETPLACE_ORDER" },
    });
    // Only the first checkout for an attempt is stored; a concurrent duplicate keeps the original link.
    const saved = await db.payment.updateMany({
      where: { transactionReference: reference, cashierUrl: null, status: "PENDING" },
      data: { cashierUrl: checkout.checkoutUrl, providerCheckoutReference: checkout.providerCheckoutReference },
    });
    if (saved.count !== 1) {
      const current = await db.payment.findUnique({ where: { transactionReference: reference }, select: { cashierUrl: true } });
      if (current?.cashierUrl) return Response.json({ cashierUrl: current.cashierUrl, provider: attempt.provider });
      throw new Error("Checkout details could not be saved.");
    }
    return Response.json({ cashierUrl: checkout.checkoutUrl, provider: attempt.provider });
  } catch (error) {
    // Outside 8am–5pm campus time: nothing was created. Checkout shows this and keeps the cart.
    if (error instanceof OrderingClosedError) return Response.json(orderingClosedBody(error), { status: 409 });
    // The code can't be used (expired, paused, used up, below its minimum, not available yet): nothing was created.
    if (error instanceof PromoCodeRejectedError) {
      return Response.json({ error: `${error.message} Nothing has been charged.`, code: "PROMO_REJECTED", reason: error.reason }, { status: 409 });
    }
    if (error instanceof OutsideServiceAreaError) {
      return Response.json({ error: `${error.message} Nothing has been charged.`, code: "OUTSIDE_SERVICE_AREA" }, { status: 409 });
    }
    if (error instanceof PriceChangedError) {
      return Response.json({ error: "Prices changed since you reviewed your order. Check the new total before paying.", code: "PRICE_CHANGED", revised: error.revised }, { status: 409 });
    }
    if (error instanceof CartNotPayableError) {
      return Response.json({ error: `${error.problems[0]} Update your cart, then try again.`, code: "CART_NOT_PAYABLE", problems: error.problems }, { status: 409 });
    }
    // Older checkout tabs show only `error`, so it says what to do on its own. The speed is never switched for them.
    if (error instanceof DeliveryTierUnavailableError) {
      return Response.json({ error: `${error.label} isn’t available right now. Refresh checkout and choose another delivery speed. Nothing has been charged.`, code: "DELIVERY_TIER_UNAVAILABLE", tier: error.tier }, { status: 409 });
    }
    if (error instanceof CheckoutAttemptMismatchError) {
      return Response.json({ error: "Your checkout changed since this payment was started. Refresh checkout, then pay. Nothing has been charged.", code: "CHECKOUT_CHANGED" }, { status: 409 });
    }
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "POST /api/payments/create");
    console.error("PAYMENT CREATE ERROR:", error instanceof Error ? error.name : "Unknown error");
    const message = error instanceof Error && /cart is empty|delivery location|no longer available|invalid quantity|not active/i.test(error.message)
      ? error.message
      : "We couldn't start your payment. Your cart is safe. Please try again.";
    return Response.json({ error: message }, { status: 400 });
  }
}
