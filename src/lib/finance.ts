export type OrderMoney = { subtotal: number; deliveryFee: number; total: number };

export function summarizeKnownOrderMoney(orders: OrderMoney[]) {
  return orders.reduce((sum, order) => {
    for (const value of [order.subtotal, order.deliveryFee, order.total]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Financial values must be non-negative integer naira amounts.");
    }
    if (order.subtotal + order.deliveryFee !== order.total) throw new Error("Order totals do not reconcile.");
    sum.productSales += order.subtotal;
    sum.deliveryFees += order.deliveryFee;
    sum.gmv += order.total;
    return sum;
  }, { productSales: 0, deliveryFees: 0, gmv: 0 });
}
