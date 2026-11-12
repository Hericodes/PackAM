import "server-only";

import { randomUUID } from "node:crypto";
import { PaymentProvider, Prisma } from "@prisma/client";
import { auth } from "../../auth";
import { db } from "../db";
import { CHECKOUT_CURRENCY } from "../checkout-pricing";
import { transitionOrderInTransaction } from "../orders/transition";
import { offerFindingOrderToAvailableRunners } from "../orders/runner-assignments";
import { createNotification, notifyAdmins } from "../notifications";
import { completeVerifiedPrintPayment } from "../printing/payment-lifecycle";
import { retrySerializable } from "../db-retry";
import { priceCart } from "../cart-pricing";
import {
  DELIVERY_TIER_LABELS,
  deliveryDueAt,
  isUrgentTier,
  parseDeliveryTier,
  parseSnapshotDeliveryTier,
  quoteFor,
  snapshotDeliveryTierFields,
  snapshotTierForReuse,
  type DeliveryTierCode,
  type SnapshotDeliveryTierFields,
} from "../delivery-tiers";
import { readDeliveryTierQuotesInTransaction, writeOrderDeliveryTierInTransaction } from "../delivery-tier-store";
import { describeDetails, parseLineDetails, type LineDetails } from "../food/plate";
import { describeOptions, parseVariantDetails, type VariantDetails } from "../products/variants";
import { CartNotPayableError, CheckoutAttemptMismatchError, DeliveryTierUnavailableError, PaymentFinalizationMismatchError, PriceChangedError } from "./payment-errors";
import { assertOrderingOpen } from "../ordering-hours";
import { assertDeliverableLocation } from "../service-area";
import { PROMO_MESSAGES, PromoCodeRejectedError, normalizePromoCode, promoFromSnapshot, snapshotHasPromo, snapshotPromoCode, type SnapshotPromo } from "../promo/promo-rules";
import { recordPromoRedemption, resolveCheckoutPromo } from "../promo/promo-store";
import { parseCartSection, type CartSection } from "../food/cart-context";
import { cashbackBalance, cashbackTablesReady, recordCashbackSpend } from "../cashback/cashback-store";
import { cashbackFromSnapshot, cashbackToUse } from "../cashback/cashback-rules";

type SnapshotItem = {
  cartItemId: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  /** Food: the meal or plate; a product with options: the variant's options. Copied onto the order item. */
  details?: LineDetails | VariantDetails;
  /** The variant bought, for products with options. */
  variantId?: string;
};

/**
 * The tier fields (deliveryTier, its window and settings version) record the delivery speed paid for. They are absent
 * on attempts started before delivery tiers; read them only with parseSnapshotDeliveryTier. deliveryFee stays the
 * one fee that is charged.
 */
type CheckoutSnapshot = {
  cartId: string;
  /** Food orders: the shop the runner must buy from. Absent for Order Stuff. */
  shopId?: string;
  items: SnapshotItem[];
  subtotal: number;
  /** The chosen delivery speed's fee when the attempt was created. */
  deliveryFee: number;
  deliveryLocationId: string;
  deliveryAddress: string;
  deliveryInstructions: string | null;
  /**
   * Frozen copies so the runner keeps the destination even if the student later deletes the saved
   * location. Taken from the database, never from the browser. Absent on older snapshots; read them
   * with deliveryPointFromSnapshot.
   */
  deliveryLocationLabel?: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  /**
   * The promo code used, if any: its id, the code and the naira taken off the items. The amount charged is
   * subtotal + deliveryFee - promo.discount. Absent when no code was used and on attempts from before promo codes.
   */
  promo?: SnapshotPromo;
  /** Set when an admin placed this order for the student (their own cart, the student's address and payment). */
  placedByAdminId?: string;
  /**
   * Naira of the student's cashback this checkout used (off the items, after any promo code). The amount charged is
   * subtotal + deliveryFee - promo discount - cashback. Absent when none was used, and before cashback existed.
   */
  cashback?: { amount: number };
} & Partial<SnapshotDeliveryTierFields>;

export type VerifiedProviderPayment = {
  /** PackAM reference returned by createPaymentAttempt. */
  transactionReference: string;
  /** Reference from the provider's verified transaction record. */
  providerReference: string;
  provider: PaymentProvider;
  amount: number;
  currency: string;
  status: "SUCCESS";
};

const ATTEMPT_FIELDS = { id: true, transactionReference: true, provider: true, status: true, amount: true, currency: true, orderId: true } as const;
const ATTEMPT_WITH_SNAPSHOT = { ...ATTEMPT_FIELDS, checkoutSnapshot: true } as const;

/**
 * An existing attempt is resumed only for the speed it was created with (none recorded = Cruise Mode) and the same
 * promo code (or none), so one key can never be reused for a different total.
 */
function resumable(attempt: Prisma.PaymentGetPayload<{ select: typeof ATTEMPT_WITH_SNAPSHOT }>, tier: DeliveryTierCode, promoCode: string | null, section: CartSection | undefined) {
  if (snapshotTierForReuse(attempt.checkoutSnapshot) !== tier) throw new CheckoutAttemptMismatchError();
  if (snapshotPromoCode(attempt.checkoutSnapshot) !== promoCode) throw new CheckoutAttemptMismatchError();
  // Nor for the other cart: a food checkout's key never resumes a shop-cart attempt, or the other way round.
  if (section !== undefined && snapshotSection(attempt.checkoutSnapshot) !== section) throw new CheckoutAttemptMismatchError();
  return { id: attempt.id, transactionReference: attempt.transactionReference, provider: attempt.provider, status: attempt.status, amount: attempt.amount, currency: attempt.currency, orderId: attempt.orderId };
}

/**
 * Creates a PENDING attempt from the authenticated student's current database cart. An admin can also place an order
 * for a student (`checkout.onBehalfOf`): the admin's own cart is checked out, but the attempt, the order, the address,
 * any promo code and the payment are the student's; the admin's cart lines are cleared straight away.
 * The provider must be selected by server code, never copied from browser input. Only the delivery
 * speed comes from the browser: its fee is the speed's current price, read in the same transaction.
 */
export async function createPaymentAttempt(
  provider: PaymentProvider,
  deliveryLocationId: string,
  idempotencyKey: string,
  deliveryInstructions?: string | null,
  /** The total the student last reviewed. If the server's total differs, nothing is created (PriceChangedError). */
  reviewedTotal?: number,
  /** The delivery speed chosen (none = Cruise Mode, all that tabs opened before tiers showed) and the fee the student reviewed. */
  delivery: { tier?: DeliveryTierCode; reviewedDeliveryFee?: number } = {},
  /** A promo code the student applied (shop and food checkout). Checked again here; it comes off the items only. */
  promo: { code?: string | null } = {},
  /**
   * Which cart to pay for: "stuff" (/checkout) or "food" (/checkout/food). Only that cart's lines are priced, charged
   * and later removed; the other cart is untouched. Left out (a checkout tab opened before the carts were separate),
   * it is the one cart that has items.
   */
  checkout: { section?: CartSection; onBehalfOf?: { studentId: string } } = {},
  /**
   * The student chose to use their cashback: as much of their balance as covers the items after any promo code is
   * taken off, worked out here from their balance right now. Never for an order an admin places for a student.
   */
  cashback: { use?: boolean } = {},
) {
  const session = await auth();
  const onBehalf = checkout.onBehalfOf;
  if (!session?.user || session.user.role !== (onBehalf ? "ADMIN" : "STUDENT")) {
    throw new Error(onBehalf ? "An admin session is required to order for a student." : "A student session is required to start checkout payment.");
  }
  // Who pays and gets the order (the student), and whose cart is checked out (theirs, or the admin's own).
  const payerId = onBehalf ? onBehalf.studentId : session.user.id;
  const cartOwnerId = session.user.id;
  if (onBehalf && (typeof payerId !== "string" || !payerId || payerId === cartOwnerId)) throw new Error("Choose the student this order is for.");

  const key = idempotencyKey.trim();
  if (!key || key.length > 128) {
    throw new Error("A valid payment idempotency key is required.");
  }
  if (!deliveryLocationId) {
    throw new Error("A delivery location is required.");
  }
  if (deliveryInstructions !== undefined && deliveryInstructions !== null && deliveryInstructions.length > 500) {
    throw new Error("Delivery instructions must be 500 characters or fewer.");
  }
  // The route has checked both already; never trust a caller to have done so.
  const tier = delivery.tier === undefined ? "CRUISE" : parseDeliveryTier(delivery.tier);
  if (!tier) throw new Error("Choose a delivery speed.");
  const reviewedDeliveryFee = delivery.reviewedDeliveryFee;
  if (reviewedDeliveryFee !== undefined && (!Number.isSafeInteger(reviewedDeliveryFee) || reviewedDeliveryFee < 0)) {
    throw new Error("The reviewed delivery fee is invalid.");
  }
  // A code that isn't even well-formed is refused before anything is read.
  const promoCode = promo.code === undefined || promo.code === null || promo.code === "" ? null : normalizePromoCode(promo.code);
  if (promo.code && !promoCode) throw new PromoCodeRejectedError("INVALID", PROMO_MESSAGES.INVALID);
  if (checkout.section !== undefined && !parseCartSection(checkout.section)) throw new Error("Choose which cart to check out.");

  try {
    // Retried on a serialization conflict (e.g. an admin changing a delivery price at the same moment): each retry
    // reads the attempt, the cart and the price again, and nothing is written until the last statement.
    return await retrySerializable(() => db.$transaction(async (tx) => {
      const existing = await tx.payment.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: payerId,
            idempotencyKey: key,
          },
        },
        select: ATTEMPT_WITH_SNAPSHOT,
      });
      // Before any pricing, so an attempt started while its speed was on sale can still be resumed after it's turned off.
      if (existing) return resumable(existing, tier, promoCode, checkout.section);
      // Outside ordering hours (8am–5pm campus time) no new attempt is created. Resuming one started in time
      // (above) still works, so a student who opened the payment page at 4:59pm can finish paying.
      assertOrderingOpen();

      const student = await tx.user.findFirst({
        where: { id: payerId, role: "STUDENT", status: "ACTIVE" },
        select: { id: true },
      });
      if (!student) throw new Error("This student account is not active.");

      const section = checkout.section ?? await onlyCartWithItems(tx, cartOwnerId);
      // Prices, availability and open shops, all from the database right now (the delivery fee follows below).
      const [cart, location] = await Promise.all([
        priceCart(tx, cartOwnerId, section),
        tx.savedLocation.findFirst({
          where: { id: deliveryLocationId, userId: student.id },
          select: { id: true, label: true, address: true, instructions: true, latitude: true, longitude: true },
        }),
      ]);

      if (!cart.cartId || !cart.lines.length) throw new Error("Your cart is empty.");
      if (!location) throw new Error("Choose one of your saved delivery locations.");
      // PackAM delivers only on OOU main campus: a pin outside it is refused (a typed location has no pin).
      assertDeliverableLocation(location);
      // Closed shop, hidden or unavailable items, or a mixed cart: nothing is charged until the student fixes it.
      if (cart.problems.length) throw new CartNotPayableError(cart.problems);

      // The chosen speed's price, read in this transaction on its own (never inside the Promise.all above).
      // A speed that is off or unpriced is refused: nothing is created, and it is never swapped for another speed.
      const quote = quoteFor(await readDeliveryTierQuotesInTransaction(tx), tier);
      if (!quote.available || quote.fee === null) throw new DeliveryTierUnavailableError(tier, quote.label);
      const deliveryFee = quote.fee;

      const items: SnapshotItem[] = cart.lines.map((line) => {
        if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
          throw new Error("A cart item has an invalid quantity.");
        }
        return {
          cartItemId: line.cartItemId,
          productId: line.productId,
          productName: line.name,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          totalPrice: line.unitPrice * line.quantity,
          ...(line.details ? { details: line.details } : {}),
          ...(line.variantId ? { variantId: line.variantId } : {}),
        };
      });

      const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
      // The promo code, checked again now against this subtotal (paused, expired, used up or below its minimum is
      // refused with the reason). Read on its own in a savepoint; it comes off the items only, never the delivery fee.
      const appliedPromo = promoCode ? await resolveCheckoutPromo(tx, promoCode, student.id, subtotal) : null;
      const discount = appliedPromo?.discount ?? 0;
      // Cashback the student chose to use: their balance right now (read in this serializable transaction, so two
      // checkouts can't spend the same naira), up to the items left after the promo code. Never the delivery fee.
      const cashbackUsed = cashback.use === true && !onBehalf && await cashbackTablesReady(tx)
        ? cashbackToUse(await cashbackBalance(tx, student.id), subtotal - discount)
        : 0;
      const amount = subtotal + deliveryFee - discount - cashbackUsed;
      if (!Number.isSafeInteger(amount) || amount <= 0 || discount + cashbackUsed > subtotal) {
        throw new Error("The checkout amount is invalid.");
      }
      // Never charge a total or a delivery fee the student hasn't seen: show them the new breakdown, for the speed
      // they chose, and let them confirm.
      if ((reviewedTotal !== undefined && reviewedTotal !== amount) || (reviewedDeliveryFee !== undefined && reviewedDeliveryFee !== deliveryFee)) {
        throw new PriceChangedError({
          subtotal,
          deliveryFee,
          total: amount,
          reviewedTotal: reviewedTotal ?? amount,
          reviewedDeliveryFee: reviewedDeliveryFee ?? null,
          deliveryTier: tier,
          deliveryTierLabel: quote.label,
          deliveryEtaMinMinutes: quote.etaMinMinutes,
          deliveryEtaMaxMinutes: quote.etaMaxMinutes,
          ...(appliedPromo ? { discount, promoCode: appliedPromo.code } : {}),
          ...(cashbackUsed ? { cashback: cashbackUsed } : {}),
          lines: cart.lines.map((line) => ({ cartItemId: line.cartItemId, name: line.details?.kind === "PLATE" ? `Plate: ${describeDetails(line.details)}` : line.details?.kind === "VARIANT" ? `${line.name} (${describeOptions(line.details.options)})` : line.name, quantity: line.quantity, unitPrice: line.unitPrice, total: line.unitPrice * line.quantity })),
        });
      }

      const snapshot: CheckoutSnapshot = {
        cartId: cart.cartId,
        ...(cart.context.kind === "food" ? { shopId: cart.context.shopId } : {}),
        items,
        subtotal,
        deliveryFee,
        // The speed, window and settings version quoted (version null without the settings table). Completion copies
        // them from here, never from current settings, so later price or switch changes never touch this payment.
        ...snapshotDeliveryTierFields(quote),
        deliveryLocationId: location.id,
        deliveryAddress: location.address,
        deliveryInstructions: deliveryInstructions === undefined ? location.instructions : deliveryInstructions,
        deliveryLocationLabel: location.label,
        ...(location.latitude !== null && location.longitude !== null ? { deliveryLatitude: location.latitude, deliveryLongitude: location.longitude } : {}),
        ...(appliedPromo ? { promo: { promoCodeId: appliedPromo.promoCodeId, code: appliedPromo.code, discount } } : {}),
        ...(onBehalf ? { placedByAdminId: session.user.id } : {}),
        ...(cashbackUsed ? { cashback: { amount: cashbackUsed } } : {}),
      };

      const created = await tx.payment.create({
        data: {
          userId: student.id,
          provider,
          status: "PENDING",
          amount,
          currency: CHECKOUT_CURRENCY,
          transactionReference: `packam_${randomUUID()}`,
          idempotencyKey: key,
          checkoutSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: ATTEMPT_FIELDS,
      });
      // The code's use, in this same transaction: it counts once this payment succeeds.
      if (appliedPromo) await recordPromoRedemption(tx, { promoCodeId: appliedPromo.promoCodeId, userId: student.id, paymentId: created.id, discount });
      // The cashback used, in this same transaction: it comes back by itself if this payment doesn't go through.
      if (cashbackUsed) await recordCashbackSpend(tx, { userId: student.id, paymentId: created.id, amount: cashbackUsed });
      // Ordering for a student: the lines leave the admin's cart now (the snapshot holds the order), so the admin can
      // build the next student's order straight away.
      if (onBehalf) await removeCapturedCartItems(tx, snapshot);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 4, baseDelayMs: 25 });
  } catch (error) {
    // If two retries race with the same key, return the attempt created by the winner (for the same speed only).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.payment.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: payerId,
            idempotencyKey: key,
          },
        },
        select: ATTEMPT_WITH_SNAPSHOT,
      });
      if (existing) return resumable(existing, tier, promoCode, checkout.section);
    }
    throw error;
  }
}

/** Which cart an attempt paid for: food snapshots name their shop; Order Stuff ones don't. */
function snapshotSection(snapshot: Prisma.JsonValue | null): CartSection {
  const shopId = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? (snapshot as Prisma.JsonObject).shopId : undefined;
  return typeof shopId === "string" && shopId ? "food" : "stuff";
}

/**
 * For a checkout that didn't say which cart (opened before the carts were separate): the one cart with items. With
 * both filled the student must pick, so nothing is charged for the wrong one.
 */
async function onlyCartWithItems(tx: Prisma.TransactionClient, userId: string): Promise<CartSection> {
  const [food, stuff] = await Promise.all([
    tx.cartItem.count({ where: { cart: { userId }, product: { shopId: { not: null } } } }),
    tx.cartItem.count({ where: { cart: { userId }, product: { shopId: null } } }),
  ]);
  if (food && stuff) throw new CartNotPayableError(["You have a food cart and a shop cart. Refresh checkout and pay for one at a time."]);
  return food ? "food" : "stuff";
}

function parseSnapshot(value: Prisma.JsonValue | null): CheckoutSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentFinalizationMismatchError("Payment attempt has no valid checkout snapshot.");
  }
  const raw = value as Prisma.JsonObject;
  const itemsValue = raw.items;
  if (!Array.isArray(itemsValue) || itemsValue.length === 0) {
    throw new PaymentFinalizationMismatchError("Payment attempt snapshot has no items.");
  }
  const items = itemsValue.map((value): SnapshotItem => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new PaymentFinalizationMismatchError("Payment attempt contains an invalid item snapshot.");
    }
    const item = value as Prisma.JsonObject;
    const fields = ["cartItemId", "productId", "productName"] as const;
    for (const field of fields) {
      if (typeof item[field] !== "string" || !item[field]) {
        throw new PaymentFinalizationMismatchError("Payment attempt contains an invalid item snapshot.");
      }
    }
    const numbers = [item.unitPrice, item.quantity, item.totalPrice];
    if (!numbers.every((number) => typeof number === "number" && Number.isSafeInteger(number))) {
      throw new PaymentFinalizationMismatchError("Payment attempt contains invalid item amounts.");
    }
    const snapshotItem = {
      cartItemId: item.cartItemId as string,
      productId: item.productId as string,
      productName: item.productName as string,
      unitPrice: item.unitPrice as number,
      quantity: item.quantity as number,
      totalPrice: item.totalPrice as number,
    };
    if (snapshotItem.quantity < 1 || snapshotItem.unitPrice < 0 || snapshotItem.totalPrice !== snapshotItem.unitPrice * snapshotItem.quantity) {
      throw new PaymentFinalizationMismatchError("Payment attempt contains inconsistent item amounts.");
    }
    const details = item.details === undefined ? null : parseLineDetails(item.details) ?? parseVariantDetails(item.details);
    if (item.details !== undefined && !details) throw new PaymentFinalizationMismatchError("Payment attempt contains an invalid item snapshot.");
    if (item.variantId !== undefined && (typeof item.variantId !== "string" || !item.variantId)) throw new PaymentFinalizationMismatchError("Payment attempt contains an invalid variant.");
    return { ...snapshotItem, ...(details ? { details } : {}), ...(typeof item.variantId === "string" ? { variantId: item.variantId } : {}) };
  });

  const subtotal = raw.subtotal;
  const deliveryFee = raw.deliveryFee;
  if (typeof subtotal !== "number" || !Number.isSafeInteger(subtotal) || typeof deliveryFee !== "number" || !Number.isSafeInteger(deliveryFee)) {
    throw new PaymentFinalizationMismatchError("Payment attempt contains invalid totals.");
  }
  if (raw.shopId !== undefined && (typeof raw.shopId !== "string" || !raw.shopId)) {
    throw new PaymentFinalizationMismatchError("Payment attempt contains an invalid food shop.");
  }
  if (typeof raw.cartId !== "string" || typeof raw.deliveryLocationId !== "string" || typeof raw.deliveryAddress !== "string") {
    throw new PaymentFinalizationMismatchError("Payment attempt contains incomplete delivery details.");
  }
  if (raw.deliveryInstructions !== null && typeof raw.deliveryInstructions !== "string") {
    throw new PaymentFinalizationMismatchError("Payment attempt contains invalid delivery instructions.");
  }
  if (items.reduce((sum, item) => sum + item.totalPrice, 0) !== subtotal) {
    throw new PaymentFinalizationMismatchError("Payment attempt subtotal does not match its items.");
  }
  // A promo that is present but malformed (or bigger than the items) is a mismatch, never silently dropped.
  const promo = promoFromSnapshot(raw);
  if (snapshotHasPromo(raw) && !promo) {
    throw new PaymentFinalizationMismatchError("Payment attempt contains an invalid promo code.");
  }
  const cashback = cashbackFromSnapshot(raw);
  if (cashback === null || (promo?.discount ?? 0) + cashback > subtotal) {
    throw new PaymentFinalizationMismatchError("Payment attempt contains an invalid cashback amount.");
  }

  return {
    cartId: raw.cartId,
    ...(typeof raw.shopId === "string" ? { shopId: raw.shopId } : {}),
    items,
    subtotal,
    deliveryFee,
    deliveryLocationId: raw.deliveryLocationId,
    deliveryAddress: raw.deliveryAddress,
    deliveryInstructions: raw.deliveryInstructions,
    ...(promo ? { promo } : {}),
    ...(cashback ? { cashback: { amount: cashback } } : {}),
  };
}

/**
 * Lowers tracked stock for each paid line with a conditional update, which Postgres applies atomically, so
 * concurrent orders can't oversell. Untracked stock (null) is left alone. Returns what couldn't be covered.
 */
async function deductStock(tx: Prisma.TransactionClient, items: SnapshotItem[]) {
  const shortfalls: string[] = [];
  for (const item of items) {
    const label = item.details?.kind === "VARIANT" ? `${item.productName} (${describeOptions(item.details.options)})` : item.productName;
    const covered = item.variantId
      ? await tx.productVariant.updateMany({ where: { id: item.variantId, stockQuantity: { gte: item.quantity } }, data: { stockQuantity: { decrement: item.quantity } } })
      : await tx.product.updateMany({ where: { id: item.productId, stockQuantity: { gte: item.quantity } }, data: { stockQuantity: { decrement: item.quantity } } });
    if (covered.count === 1) continue;
    const tracked = item.variantId
      ? await tx.productVariant.findUnique({ where: { id: item.variantId }, select: { stockQuantity: true } })
      : await tx.product.findUnique({ where: { id: item.productId }, select: { stockQuantity: true } });
    if (!tracked || tracked.stockQuantity === null) continue; // not tracked: sourced on demand, as before
    shortfalls.push(`${label}: ${item.quantity} paid for, ${tracked.stockQuantity} in stock`);
    if (item.variantId) await tx.productVariant.update({ where: { id: item.variantId }, data: { stockQuantity: 0 } });
    else await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: 0 } });
  }
  return shortfalls;
}

/** Remove only quantities captured by this attempt. Later cart edits/additions survive. */
async function removeCapturedCartItems(tx: Prisma.TransactionClient, snapshot: CheckoutSnapshot) {
  for (const item of snapshot.items) {
    const currentItem = await tx.cartItem.findFirst({
      where: { id: item.cartItemId, cartId: snapshot.cartId, productId: item.productId },
      select: { quantity: true },
    });
    if (!currentItem) continue;
    if (currentItem.quantity <= item.quantity) {
      await tx.cartItem.delete({ where: { id: item.cartItemId } });
    } else {
      await tx.cartItem.update({
        where: { id: item.cartItemId },
        data: { quantity: { decrement: item.quantity } },
      });
    }
  }
}

/** For a student-cancelled unpaid checkout: drop the items that checkout captured from the cart. */
export async function removeCheckoutItemsFromCart(tx: Prisma.TransactionClient, checkoutSnapshot: Prisma.JsonValue | null) {
  await removeCapturedCartItems(tx, parseSnapshot(checkoutSnapshot));
}

/**
 * Freezes the paid speed onto the new order, copied from the attempt's snapshot only (never current settings, so a
 * speed turned off or repriced after payment started is still honoured). Never blocks the order: when the row can't
 * be written (tables missing, or a damaged snapshot) an Oya Now!/Sharp Sharp order alerts admins to dispatch it by hand.
 */
async function recordOrderDeliveryTier(tx: Prisma.TransactionClient, orderId: string, checkoutSnapshot: Prisma.JsonValue | null, confirmedAt: Date) {
  const paid = parseSnapshotDeliveryTier(checkoutSnapshot);
  if (paid.kind === "legacy") return; // paid before delivery tiers: "Standard delivery", Cruise priority
  const written = paid.kind === "tier" && await writeOrderDeliveryTierInTransaction(tx, {
    orderId, tier: paid.tier, etaMinMinutes: paid.etaMinMinutes, etaMaxMinutes: paid.etaMaxMinutes,
    dueAt: deliveryDueAt(confirmedAt, paid.etaMaxMinutes), settingsVersion: paid.settingsVersion,
  });
  if (written || (paid.kind === "tier" && !isUrgentTier(paid.tier))) return;
  await notifyAdmins(tx, {
    type: "ORDER",
    title: "Delivery speed not recorded",
    message: paid.kind === "tier"
      ? `Order ${orderId} was paid for ${DELIVERY_TIER_LABELS[paid.tier]} but its delivery speed couldn’t be saved. Dispatch it as urgent by hand.`
      : `Order ${orderId} was paid with an unreadable delivery speed. Check its payment snapshot and dispatch it by hand.`,
    orderId,
    idempotencyKey: `delivery-tier-unrecorded:${orderId}`,
  });
}

/**
 * Call only after a provider adapter has verified the webhook signature and
 * independently confirmed the transaction with the provider. Never expose this
 * function through a browser-facing route.
 */
export async function completeVerifiedPayment(verified: VerifiedProviderPayment) {
  if (verified.status !== "SUCCESS" || !verified.transactionReference || !verified.providerReference) {
    throw new Error("A verified successful provider transaction is required.");
  }
  const linkedPrintPayment = await db.payment.findUnique({
    where: { transactionReference: verified.transactionReference },
    select: { printJobId: true },
  });
  if (linkedPrintPayment?.printJobId) return completeVerifiedPrintPayment(verified);

  let finalizationStarted = false;
  try {
    // Money path: give conflicting finalisations generous retries before falling back to reconciliation.
    return await retrySerializable(() => db.$transaction(async (tx) => {
    const attempt = await tx.payment.findUnique({
      where: { transactionReference: verified.transactionReference },
    });
    if (!attempt) throw new Error("Payment attempt not found.");
    if (attempt.provider !== verified.provider) throw new PaymentFinalizationMismatchError("Payment provider does not match the attempt.");
    if (attempt.amount !== verified.amount || attempt.currency !== verified.currency.toUpperCase()) {
      throw new PaymentFinalizationMismatchError("Verified payment amount or currency does not match the checkout.");
    }

    if (attempt.status === "SUCCESS") {
      if (attempt.providerReference !== verified.providerReference || !attempt.orderId) {
        throw new PaymentFinalizationMismatchError("Payment attempt was already completed with a different transaction.");
      }
      return { orderId: attempt.orderId, alreadyProcessed: true };
    }
    if (!["PENDING", "RECONCILIATION_REQUIRED"].includes(attempt.status) || attempt.orderId) {
      throw new Error("Payment attempt is no longer pending.");
    }
    if (attempt.providerReference && attempt.providerReference !== verified.providerReference) {
      throw new PaymentFinalizationMismatchError("Payment attempt was already verified with a different provider transaction.");
    }

    const snapshot = parseSnapshot(attempt.checkoutSnapshot);
    // The order keeps the full items subtotal and delivery fee; its total is what was paid (less any promo discount).
    if (attempt.amount !== snapshot.subtotal + snapshot.deliveryFee - (snapshot.promo?.discount ?? 0) - (snapshot.cashback?.amount ?? 0)) {
      throw new PaymentFinalizationMismatchError("Payment amount does not match the saved checkout snapshot.");
    }
    finalizationStarted = true;

    const location = await tx.savedLocation.findFirst({
      where: { id: snapshot.deliveryLocationId, userId: attempt.userId },
      select: { id: true },
    });
    const confirmedAt = new Date();
    const order = await tx.order.create({
      data: {
        userId: attempt.userId,
        status: "PAYMENT_CONFIRMED",
        // One clock for the order: dispatch, urgent escalation and the delivery due time all start here.
        findingRunnerAt: confirmedAt,
        subtotal: snapshot.subtotal,
        deliveryFee: snapshot.deliveryFee,
        total: attempt.amount,
        currency: attempt.currency,
        deliveryLocationId: location?.id ?? null,
        deliveryAddress: snapshot.deliveryAddress,
        deliveryInstructions: snapshot.deliveryInstructions,
        // Food: the shop stays on the order for runner assignment and fulfilment.
        shopId: snapshot.shopId ?? null,
        items: {
          create: snapshot.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
            // The plate or the variant's options as paid for, frozen: later catalogue edits never change it.
            ...(item.details ? { details: item.details as unknown as Prisma.InputJsonValue } : {}),
            ...(item.variantId ? { variantId: item.variantId } : {}),
          })),
        },
        statusHistory: {
          create: {
            status: "PAYMENT_CONFIRMED",
            note: "Payment verified by provider.",
            createdAt: confirmedAt,
          },
        },
      },
      select: { id: true },
    });
    // The paid speed goes on the order before it is offered to runners, so the offers can follow its priority.
    await recordOrderDeliveryTier(tx, order.id, attempt.checkoutSnapshot, confirmedAt);

    await transitionOrderInTransaction(tx, {
      orderId: order.id,
      toStatus: "FINDING_RUNNER",
      note: "Order is ready for runner assignment.",
    });
    const claim = await tx.payment.updateMany({
      where: {
        id: attempt.id,
        status: attempt.status,
        orderId: null,
        OR: [{ providerReference: null }, { providerReference: verified.providerReference }],
      },
      data: {
        status: "SUCCESS",
        providerReference: verified.providerReference,
        paidAt: attempt.paidAt ?? confirmedAt,
        orderId: order.id,
      },
    });
    if (claim.count !== 1) throw new Error("Payment attempt was already claimed.");

    await removeCapturedCartItems(tx, snapshot);

    // Tracked stock goes down now, atomically, so two orders can never take the same last unit.
    // The payment is already verified: if stock ran out meanwhile, the order still stands and operations
    // is alerted to source the item or refund it through the existing unavailable-item process.
    const shortfalls = await deductStock(tx, snapshot.items);
    if (shortfalls.length) {
      await notifyAdmins(tx, {
        type: "ORDER",
        title: "Stock ran out for a paid order",
        message: `${shortfalls.join("; ")}. Source the missing quantity or mark it unavailable so the student is refunded.`,
        orderId: order.id,
        idempotencyKey: `stock-shortfall:${order.id}`,
      });
    }

await offerFindingOrderToAvailableRunners(tx, order.id);

    return { orderId: order.id, alreadyProcessed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 8, baseDelayMs: 25 });
  } catch (error) {
    const current = await db.payment.findUnique({
      where: { transactionReference: verified.transactionReference },
      select: { status: true, providerReference: true, orderId: true },
    }).catch(() => null);
    // A concurrent duplicate (provider webhook plus the student's status poll) already completed this
    // same verified transaction. That is success, not something for operations to reconcile.
    if (current?.status === "SUCCESS" && current.orderId && current.providerReference === verified.providerReference) {
      return { orderId: current.orderId, alreadyProcessed: true };
    }
    // The provider verified a success for an attempt PackAM had recorded as FAILED: money may have been
    // captured with no order. Alert operations; do not change the payment or create an order here.
    if (current?.status === "FAILED" && !current.orderId) {
      try {
        await db.$transaction((tx) => notifyAdmins(tx, { type: "PAYMENT", title: "Payment succeeded after failure", message: `Provider verified payment ${verified.transactionReference} as successful after PackAM marked it failed. Check it and refund or fulfil manually.`, idempotencyKey: `payment-late-success:${verified.transactionReference}` }));
      } catch (notificationError) {
        console.error("LATE PAYMENT SUCCESS ALERT ERROR:", notificationError instanceof Error ? notificationError.name : "Unknown error");
      }
    }
    if (finalizationStarted) {
      try {
        await db.payment.updateMany({
          where: {
            transactionReference: verified.transactionReference,
            provider: verified.provider,
            status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] },
            orderId: null,
            OR: [{ providerReference: null }, { providerReference: verified.providerReference }],
          },
          data: {
            status: "RECONCILIATION_REQUIRED",
            providerReference: verified.providerReference,
            paidAt: new Date(),
          },
        });
      } catch (reconciliationError) {
        console.error("PAYMENT RECONCILIATION RECORD ERROR:", reconciliationError instanceof Error ? reconciliationError.name : "Unknown error");
      }
      try {
        await db.$transaction((tx) => notifyAdmins(tx, { type: "PAYMENT", title: "Payment needs attention", message: `Verified payment ${verified.transactionReference} needs order reconciliation.`, idempotencyKey: `payment-reconciliation:${verified.transactionReference}` }));
      } catch (notificationError) {
        console.error("PAYMENT RECONCILIATION ALERT ERROR:", notificationError instanceof Error ? notificationError.name : "Unknown error");
      }
    }
    throw error;
  }
}

/** Mark a verified terminal provider failure without creating an order or touching the cart. */
export async function failPendingPayment(transactionReference: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { transactionReference, status: "PENDING", orderId: null }, select: { id: true, userId: true, amount: true, printJobId: true } });
    if (!payment) return false;
    const result = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING", orderId: null }, data: { status: "FAILED", failedAt: new Date() } });
    if (result.count !== 1) return false;
    await createNotification(tx, {
      userId: payment.userId,
      type: "PAYMENT",
      title: payment.printJobId ? "Print payment wasn’t completed" : "Payment failed",
      message: payment.printJobId
        ? `Payment wasn’t completed — ₦${payment.amount.toLocaleString()}. Your print job is safe to retry.`
        : `Payment no go through — ₦${payment.amount.toLocaleString()}. Your order never confirm, but your cart is still here.`,
      relatedType: payment.printJobId ? "PRINT_JOB" : null,
      relatedId: payment.printJobId,
      idempotencyKey: `payment-failed:${payment.id}`,
    });
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Preserve an uncertain provider attempt for operations review; never convert it to SUCCESS/FAILED. */
export async function markPaymentNeedsReview(transactionReference: string, reason: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { transactionReference, provider: { in: ["OPAY", "PAYSTACK"] }, status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] }, orderId: null }, select: { id: true, userId: true, amount: true, status: true, printJobId: true } });
    if (!payment) return false;
    if (payment.status === "PENDING") {
      const changed = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING", orderId: null }, data: { status: "RECONCILIATION_REQUIRED" } });
      if (changed.count !== 1) return false;
    }
    await createNotification(tx, {
      userId: payment.userId,
      type: "PAYMENT",
      title: payment.printJobId ? "Print payment requires attention" : "Payment requires attention",
      message: `Payment of ₦${payment.amount.toLocaleString()} needs a manual check. Please don’t pay again yet.`,
      relatedType: payment.printJobId ? "PRINT_JOB" : null,
      relatedId: payment.printJobId,
      idempotencyKey: `payment-review:${payment.id}`,
    });
    await notifyAdmins(tx, {
      type: "PAYMENT",
      title: payment.printJobId ? "Print payment needs attention" : "Payment needs attention",
      message: `PackAM payment ${transactionReference} needs review (${reason.slice(0, 120)}).`,
      relatedType: payment.printJobId ? "PRINT_JOB" : null,
      relatedId: payment.printJobId,
      idempotencyKey: `payment-review-admin:${payment.id}`,
    });
    return true;
  });
}
