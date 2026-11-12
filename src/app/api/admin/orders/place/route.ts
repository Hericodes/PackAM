import { db } from "../../../../../lib/db";
import { adminApiAccess } from "../../../../../lib/admin/admin-access";
import { createPaymentAttempt } from "../../../../../lib/payments/payment-lifecycle";
import { checkoutProvider, createHostedCheckout } from "../../../../../lib/payments/gateways";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { CartNotPayableError, CheckoutAttemptMismatchError, DeliveryTierUnavailableError, PriceChangedError } from "../../../../../lib/payments/payment-errors";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../../../lib/db-errors";
import { parseCheckoutDeliveryRequest } from "../../../../../lib/delivery-tiers";
import { manualTransferAccount } from "../../../../../lib/payments/manual-transfer";
import { awaitStudentTransfer, ensureManualCheckout } from "../../../../../lib/payments/manual-transfer-store";
import { OrderingClosedError, orderingClosedBody } from "../../../../../lib/ordering-hours";
import { OutsideServiceAreaError } from "../../../../../lib/service-area";
import { PromoCodeRejectedError } from "../../../../../lib/promo/promo-rules";
import { parseCartSection } from "../../../../../lib/food/cart-context";
import { deriveLocationLabel } from "../../../../../lib/location-choice";
import { createNotification } from "../../../../../lib/notifications";
import { writeAuditLogOutsideTransaction } from "../../../../../lib/audit";

export const runtime = "nodejs";

const text = (body: Record<string, unknown>, key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

/**
 * An admin places an order for a student (e.g. one that came in on WhatsApp). The admin's own cart (food or shop, from
 * the normal Food and shop pages) becomes the student's order: the student is the customer, the address is theirs,
 * any promo code is checked against them, and they pay. Same prices, ordering hours, campus area and delivery speeds as
 * any checkout, all decided on the server.
 *
 * Body: { cart: "food"|"stuff", studentId, locationId? | address (+ label?), deliveryInstructions?, deliveryTier,
 * reviewedTotal, reviewedDeliveryFee, promoCode? } with an Idempotency-Key header.
 *
 * Bank transfer (PAYMENT_PROVIDER=MANUAL): the answer has the account and the transfer code to send the student; the
 * payment waits (no 30-minute expiry) until an admin confirms the money on the Payments page, then the order starts.
 * A payment gateway: the answer has a payment link to send the student. Either way the student is notified too.
 */
export async function POST(request: Request) {
  const allowed = await adminApiAccess();
  if (!allowed.ok) return allowed.response;
  const admin = allowed.access;
  const rate = await consumeRateLimit(`admin-place-order:${admin.userId}`, 20, 10 * 60_000);
  if (!rate.allowed) return Response.json({ error: "Please wait a little before placing another order." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const idempotencyKey = request.headers.get("Idempotency-Key");
  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: "Choose the student and where to deliver." }, { status: 400 }); }
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const section = parseCartSection(body.cart);
  const studentId = text(body, "studentId");
  if (!section || !studentId || studentId.length > 100 || !idempotencyKey) return Response.json({ error: "Choose the student this order is for." }, { status: 400 });
  const reviewedTotal = body.reviewedTotal;
  if (typeof reviewedTotal !== "number" || !Number.isSafeInteger(reviewedTotal) || reviewedTotal < 0) return Response.json({ error: "Refresh checkout to see the total, then place the order." }, { status: 400 });
  const delivery = parseCheckoutDeliveryRequest(body);
  if (!delivery.ok) return Response.json({ error: delivery.error, code: delivery.code }, { status: 400 });
  const promoCode = body.promoCode;
  if (promoCode !== undefined && promoCode !== null && (typeof promoCode !== "string" || promoCode.length > 40)) return Response.json({ error: "That promo code isn’t valid. Remove it and try again.", code: "PROMO_REJECTED" }, { status: 400 });
  const instructions = text(body, "deliveryInstructions");
  if (instructions.length > 500) return Response.json({ error: "Delivery instructions must be 500 characters or fewer." }, { status: 400 });

  const provider = checkoutProvider();
  const transferAccount = manualTransferAccount(process.env);
  if (provider === "MANUAL" && !transferAccount) return Response.json({ error: "Bank transfer details aren’t set up, so the student would have nowhere to pay. Set MANUAL_TRANSFER_* in Vercel first." }, { status: 503 });

  try {
    const student = await db.user.findFirst({ where: { id: studentId, role: "STUDENT", status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } });
    if (!student) return Response.json({ error: "That student account isn’t active any more. Choose another." }, { status: 404 });
    const studentName = [student.firstName, student.lastName].filter(Boolean).join(" ") || student.email;

    // The delivery place: one of the student's saved locations, or an address the admin typed (saved to their account).
    let locationId = text(body, "locationId");
    if (locationId) {
      const owned = await db.savedLocation.findFirst({ where: { id: locationId, userId: student.id }, select: { id: true } });
      if (!owned) return Response.json({ error: "That location isn’t one of this student’s. Choose again." }, { status: 400 });
    } else {
      const address = text(body, "address");
      const label = text(body, "label") || deriveLocationLabel(address);
      if (!address) return Response.json({ error: "Enter where to deliver (hostel, room or landmark)." }, { status: 400 });
      if (address.length > 300 || !label || label.length > 50) return Response.json({ error: "That address is too long. Shorten it and try again." }, { status: 400 });
      // A retry with the same address reuses the location instead of saving it twice. Typed places have no GPS pin.
      const existing = await db.savedLocation.findFirst({ where: { userId: student.id, address, label, latitude: null }, select: { id: true } });
      locationId = existing?.id ?? (await db.savedLocation.create({ data: { userId: student.id, label, address }, select: { id: true } })).id;
    }

    const attempt = await createPaymentAttempt(
      provider, locationId, idempotencyKey, instructions || null, reviewedTotal,
      { tier: delivery.tier, reviewedDeliveryFee: delivery.reviewedDeliveryFee },
      { code: typeof promoCode === "string" ? promoCode : null },
      { section, onBehalfOf: { studentId: student.id } },
    );
    if (attempt.status === "SUCCESS" || attempt.status === "FAILED") return Response.json({ error: "That order was already placed or closed. Start again from the cart." }, { status: 409 });
    const reference = attempt.transactionReference!;

    let payment: { kind: "transfer"; code: string; bankName: string; accountNumber: string; accountName: string } | { kind: "link"; url: string };
    if (attempt.provider === "MANUAL") {
      await ensureManualCheckout(reference);
      const waiting = await awaitStudentTransfer(reference);
      if (!waiting?.transferCode || !transferAccount) throw new Error("A transfer code could not be assigned.");
      payment = { kind: "transfer", code: waiting.transferCode, ...transferAccount };
    } else {
      const stored = await db.payment.findUnique({ where: { transactionReference: reference }, select: { cashierUrl: true } });
      let url = stored?.cashierUrl ?? null;
      if (!url) {
        const appUrl = process.env.APP_URL;
        if (!appUrl) throw new Error("APP_URL is required for payment return and webhook URLs.");
        const checkout = await createHostedCheckout(attempt.provider, {
          reference, amount: attempt.amount, productName: "PackAM campus order", description: "PackAM order placed for you by the PackAM team",
          customer: { id: student.id, name: studentName, email: student.email, phone: student.phone ?? undefined },
          returnPath: "/checkout/payment-result", returnQuery: { reference }, baseUrl: new URL(appUrl),
          metadata: { packamReference: reference, kind: "MARKETPLACE_ORDER" },
        });
        await db.payment.updateMany({ where: { transactionReference: reference, cashierUrl: null, status: "PENDING" }, data: { cashierUrl: checkout.checkoutUrl, providerCheckoutReference: checkout.providerCheckoutReference } });
        url = (await db.payment.findUnique({ where: { transactionReference: reference }, select: { cashierUrl: true } }))?.cashierUrl ?? checkout.checkoutUrl;
      }
      payment = { kind: "link", url };
    }

    // The student hears about it from PackAM too, with how to pay. Both are best effort: the order is already placed.
    await createNotification(db, {
      userId: student.id,
      type: "PAYMENT",
      title: "PackAM placed an order for you",
      message: payment.kind === "transfer"
        ? `Send ${naira(attempt.amount)} to ${payment.bankName} ${payment.accountNumber} (${payment.accountName}) with code ${payment.code} in the remark. Your order starts once we confirm it.`
        : `Pay ${naira(attempt.amount)} to start your order.`,
      relatedType: "PAYMENT",
      relatedId: reference,
      idempotencyKey: `admin-placed-order:${reference}`,
    }).catch((error) => console.error("ADMIN ORDER NOTIFY ERROR:", error instanceof Error ? error.name : "Unknown error"));
    await writeAuditLogOutsideTransaction({
      actorId: admin.userId, action: "order.placed_for_student", resource: "Payment", resourceId: attempt.id,
      newState: { studentId: student.id, amount: attempt.amount, cart: section, provider: attempt.provider },
      details: `Placed a ${section === "food" ? "food" : "shop"} order for ${student.email}: ${naira(attempt.amount)}.`,
    }).catch((error) => console.error("ADMIN ORDER AUDIT ERROR:", error instanceof Error ? error.name : "Unknown error"));

    return Response.json({ placed: { reference, amount: attempt.amount, student: { id: student.id, name: studentName, phone: student.phone }, payment } });
  } catch (error) {
    if (error instanceof OrderingClosedError) return Response.json(orderingClosedBody(error), { status: 409 });
    if (error instanceof PromoCodeRejectedError) return Response.json({ error: `${error.message} Nothing has been charged.`, code: "PROMO_REJECTED", reason: error.reason }, { status: 409 });
    if (error instanceof OutsideServiceAreaError) return Response.json({ error: `${error.message} Nothing has been charged.`, code: "OUTSIDE_SERVICE_AREA" }, { status: 409 });
    if (error instanceof PriceChangedError) return Response.json({ error: "Prices changed since you reviewed this order. Check the new total, then place it.", code: "PRICE_CHANGED", revised: error.revised }, { status: 409 });
    if (error instanceof CartNotPayableError) return Response.json({ error: `${error.problems[0]} Update the cart, then try again.`, code: "CART_NOT_PAYABLE", problems: error.problems }, { status: 409 });
    if (error instanceof DeliveryTierUnavailableError) return Response.json({ error: `${error.label} isn’t available right now. Choose another delivery speed. Nothing has been charged.`, code: "DELIVERY_TIER_UNAVAILABLE", tier: error.tier }, { status: 409 });
    if (error instanceof CheckoutAttemptMismatchError) return Response.json({ error: "This checkout changed since the order was started. Check it, then place it again. Nothing has been charged.", code: "CHECKOUT_CHANGED" }, { status: 409 });
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "POST /api/admin/orders/place");
    console.error("ADMIN PLACE ORDER ERROR:", error instanceof Error ? error.name : "Unknown error");
    const message = error instanceof Error && /cart is empty|no longer available|invalid quantity|not active/i.test(error.message) ? error.message : "We couldn’t place that order. Try again.";
    return Response.json({ error: message }, { status: 500 });
  }
}
