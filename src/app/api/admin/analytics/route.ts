import { auth } from "../../../../auth";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../../lib/db-errors";
import { loadAnalytics, type AnalyticsData } from "../../../../lib/analytics/queries";
import { parseRange } from "../../../../lib/analytics/range";

/**
 * Admin-only analytics for a date range. Only aggregates leave the server: counts, sums, product and category
 * names and page paths (record ids collapsed) - never a customer, email, address or payment reference.
 *
 * Results are kept for a minute per range, so refreshing or several admins looking don't repeat the queries.
 */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; data: AnalyticsData }>();

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to view analytics." }, { status: 401 });
  if (session.user.role !== "ADMIN") return Response.json({ error: "Only PackAM admins can view analytics." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const parsed = parseRange({ range: params.get("range"), from: params.get("from"), to: params.get("to") }, new Date());
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const key = `${parsed.range.from.toISOString()}|${parsed.range.to.toISOString()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Response.json(hit.data, { headers: { "Cache-Control": "private, no-store" } });
  try {
    const data = await loadAnalytics(parsed.range);
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 30) cache.delete(cache.keys().next().value!);
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "GET /api/admin/analytics");
    console.error("ANALYTICS ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Analytics couldn’t load. Try again." }, { status: 500 });
  }
}
