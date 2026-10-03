import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";

export default async function CartPage() {
  const session = await requireRole("STUDENT", "/cart");
  const cart = await db.cart.findUnique({
    where: { userId: session.user.id },
    select: { items: { select: { id: true }, take: 1 } },
  });
  redirect(cart?.items.length ? "/checkout" : "/search");
}
