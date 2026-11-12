import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { priceCart } from "../../../../lib/cart-pricing";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { PromoCodeRejectedError } from "../../../../lib/promo/promo-rules";
import { resolveCheckoutPromo } from "../../../../lib/promo/promo-store";
import { parseCartSection } from "../../../../lib/food/cart-context";

export const runtime = "nodejs";

/**
 * Checkout's "Apply" button: can this student use this code on their cart right now? Body { code }.
 *
 * 200 { promo: { code, label, discount, rule } }: `rule` lets checkout recompute the discount as quantities change;
 * payment checks the code again and charges the server's amount. 409 { error, code: "PROMO_REJECTED", reason } says
 * why not (unknown, paused, expired, used up, already used, below the minimum, not available yet). Nothing is written.
 * Rate-limited per student so codes can't be guessed by trying many.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to use a promo code." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only students can use promo codes." }, { status: 403 });
  const rate = await consumeRateLimit(`promo-check:${session.user.id}`, 10, 10 * 60 * 1000);
  if (!rate.allowed) {
    return Response.json({ error: "Too many promo code tries. Wait a few minutes, then try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Enter a promo code." }, { status: 400 }); }
  const code = body && typeof body === "object" && "code" in body ? (body as { code?: unknown }).code : undefined;
  if (typeof code !== "string" || !code.trim() || code.length > 40) return Response.json({ error: "Enter a promo code." }, { status: 400 });

  // The cart being checked out: "stuff" or "food" (absent from tabs opened before the carts were separate: Order
  // Stuff unless only the food cart has items).
  const rawSection = body && typeof body === "object" && "cart" in body ? (body as { cart?: unknown }).cart : undefined;
  const requested = rawSection === undefined ? undefined : parseCartSection(rawSection);
  if (requested === null) return Response.json({ error: "Refresh checkout, then try the code again." }, { status: 400 });

  try {
    let cart = await priceCart(db, session.user.id, requested ?? "stuff");
    if (requested === undefined && !cart.lines.length) cart = await priceCart(db, session.user.id, "food");
    if (!cart.lines.length) return Response.json({ error: "Add something to your cart first." }, { status: 409 });
    const promo = await resolveCheckoutPromo(db, code, session.user.id, cart.subtotal);
    return Response.json({ promo: { code: promo.code, label: promo.label, discount: promo.discount, rule: promo.rule } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PromoCodeRejectedError) return Response.json({ error: error.message, code: "PROMO_REJECTED", reason: error.reason }, { status: 409 });
    console.error("PROMO CHECK ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t check that code right now. Try again." }, { status: 500 });
  }
}
