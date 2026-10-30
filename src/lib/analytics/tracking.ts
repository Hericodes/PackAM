/**
 * What counts as a page view. Pure, so the rules are unit-tested; /api/analytics/pageview applies them.
 *
 * Only anonymous facts are kept: random visitor/session/view ids made by the browser, the page path with
 * record ids collapsed (no query string or fragment), and the referring site's host. Staff pages, bots,
 * headless browsers and visitors who ask not to be tracked (Do Not Track / Global Privacy Control) are skipped.
 */

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Paths that are never customer traffic. */
const STAFF_PREFIXES = ["/admin", "/runner", "/api", "/_next"];

const BOT_PATTERN = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python-requests|node-fetch|axios|go-http|java\/|phantom|puppeteer|playwright|selenium/i;

export type PageViewInput = { viewId: string; visitorId: string; sessionId: string; path: string; referrerHost: string | null };

/** Record ids (cuid, uuid, long hex/number) become ":id", so pages group together and no id is kept. */
export function normalisePath(raw: string) {
  const path = raw.split(/[?#]/)[0] || "/";
  const clean = path
    .split("/")
    .map((segment) => (/^c[a-z0-9]{20,32}$/.test(segment) || /^[0-9a-f-]{32,36}$/i.test(segment) || /^\d{6,}$/.test(segment) ? ":id" : segment))
    .join("/")
    .replace(/\/{2,}/g, "/");
  return (clean.length > 1 ? clean.replace(/\/$/, "") : clean).slice(0, 300);
}

/** The referring site's host when it's another site, without "www." Nothing for PackAM's own pages. */
export function referrerHostOf(referrer: unknown, ownHost: string) {
  if (typeof referrer !== "string" || !referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const own = ownHost.toLowerCase().split(":")[0].replace(/^www\./, "");
    return host === own ? null : host.slice(0, 255);
  } catch {
    return null;
  }
}

export function isBot(userAgent: string | null) {
  return !userAgent || BOT_PATTERN.test(userAgent);
}

/** Do Not Track or Global Privacy Control. */
export function optedOut(headers: { get(name: string): string | null }) {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}

export function parsePageView(body: unknown, ownHost: string): { ok: true; view: PageViewInput } | { ok: false; reason: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid" };
  const b = body as Record<string, unknown>;
  for (const key of ["viewId", "visitorId", "sessionId"] as const) {
    if (typeof b[key] !== "string" || !ID_PATTERN.test(b[key] as string)) return { ok: false, reason: "invalid" };
  }
  if (typeof b.path !== "string" || !b.path.startsWith("/") || b.path.length > 2000) return { ok: false, reason: "invalid" };
  const path = normalisePath(b.path);
  if (STAFF_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return { ok: false, reason: "staff-page" };
  return { ok: true, view: { viewId: b.viewId as string, visitorId: b.visitorId as string, sessionId: b.sessionId as string, path, referrerHost: referrerHostOf(b.referrer, ownHost) } };
}
