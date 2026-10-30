import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { clientAddress, consumeRateLimit } from "../../../../lib/rate-limit";
import { isBot, optedOut, parsePageView } from "../../../../lib/analytics/tracking";

const HOUR_MS = 60 * 60 * 1000;
/** Generous for a person browsing; stops one address flooding the table. */
const VIEWS_PER_ADDRESS_PER_HOUR = 600;

/**
 * Records one anonymous page view (see lib/analytics/tracking.ts for what is kept). Always answers 204 for a
 * view it chose not to count, so the browser never retries or shows an error; 400 only for a malformed body.
 * A retried send with the same viewId is ignored, so a view is never counted twice.
 */
export async function POST(request: Request) {
  if (isBot(request.headers.get("user-agent")) || optedOut(request.headers)) return new Response(null, { status: 204 });
  let body: unknown;
  try { body = JSON.parse(await request.text()); } catch { return new Response(null, { status: 400 }); }
  const parsed = parsePageView(body, new URL(request.url).host);
  if (!parsed.ok) return new Response(null, { status: parsed.reason === "invalid" ? 400 : 204 });

  try {
    // Staff browsing the shop isn't customer traffic.
    const session = await auth();
    if (session?.user?.role === "ADMIN" || session?.user?.role === "RUNNER") return new Response(null, { status: 204 });
    const rate = await consumeRateLimit(`pageview:${clientAddress(request)}`, VIEWS_PER_ADDRESS_PER_HOUR, HOUR_MS);
    if (!rate.allowed) return new Response(null, { status: 204 });
    await db.pageView.createMany({ data: [parsed.view], skipDuplicates: true });
    return new Response(null, { status: 204 });
  } catch (error) {
    // Analytics must never break the site: log the kind of failure, never the payload.
    console.error("PAGE VIEW ERROR:", error instanceof Error ? error.name : "Unknown error");
    return new Response(null, { status: 204 });
  }
}
