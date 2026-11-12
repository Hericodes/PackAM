import type { Metadata } from "next";
import { CheckoutScreen } from "../../../../components/checkout/CheckoutScreen";

export const metadata: Metadata = { title: "Food checkout" };

/** The food cart's checkout: meals and plates from one food shop. Order Stuff is checked out at /checkout. */
export default function FoodCheckoutPage() {
  return <CheckoutScreen section="food" />;
}
