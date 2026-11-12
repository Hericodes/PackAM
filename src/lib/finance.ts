export type OrderMoney = { subtotal: number; deliveryFee: number; total: number };

/**
 * Sums orders into product sales, delivery fees, discounts and GMV (what customers paid). Promo codes and cashback
 * come off the items only, so for every order total = subtotal + deliveryFee - discount, with 0 <= discount <= subtotal;
 * the discount (promo + cashback) is not stored separately on the order, it is what reconciles the three stored amounts.
 */
export function summarizeKnownOrderMoney(orders: OrderMoney[]) {
  return orders.reduce((sum, order) => {
    for (const value of [order.subtotal, order.deliveryFee, order.total]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Financial values must be non-negative integer naira amounts.");
    }
    const discount = promoDiscountOf(order);
    if (discount < 0 || discount > order.subtotal) throw new Error("Order totals do not reconcile.");
    sum.productSales += order.subtotal;
    sum.deliveryFees += order.deliveryFee;
    sum.promoDiscounts += discount;
    sum.gmv += order.total;
    return sum;
  }, { productSales: 0, deliveryFees: 0, promoDiscounts: 0, gmv: 0 });
}

/** Everything taken off an order's items (promo code and cashback together): items + delivery - what was paid. */
export function promoDiscountOf(order: OrderMoney) {
  return order.subtotal + order.deliveryFee - order.total;
}

/** The order's discount split into the promo code's part and the cashback's part (from its payment snapshot). */
export function splitOrderDiscount(order: OrderMoney, cashbackUsed: number | null) {
  const total = promoDiscountOf(order);
  const cashback = Math.max(0, Math.min(total, cashbackUsed ?? 0));
  return { promo: total - cashback, cashback };
}
