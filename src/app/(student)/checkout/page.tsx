import { CheckoutScreen } from "../../../components/checkout/CheckoutScreen";

/** The shop cart's checkout (Order Stuff). Food has its own: /checkout/food. Printing has its own: /printing. */
export default function CheckoutPage() {
  return <CheckoutScreen section="stuff" />;
}
