/**
 * Cross-site protection for the account API. Every POST, PATCH and DELETE handler calls rejectCrossSite() first,
 * and handlers that read a JSON body also call requireJson(). The session cookie is SameSite=Lax, and another site
 * can only send a form or text/plain body without the browser asking this server first, so an endpoint that takes
 * JSON from its own origin only can't be driven from elsewhere. Requests with neither Sec-Fetch-Site nor Origin
 * (server-to-server calls, tests) pass. Pure, so it is unit-tested with plain Request objects.
 */

/** Sec-Fetch-Site values a page on PackAM itself never sends. ("same-site" is a sibling subdomain.) */
const OTHER_SITE = new Set(["cross-site", "same-site"]);

/** 403 when the browser says the request came from another site, or its Origin isn't this host; otherwise null. */
export function rejectCrossSite(request: Request): Response | null {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && OTHER_SITE.has(fetchSite)) return crossSiteResponse();
  const origin = request.headers.get("origin");
  if (origin !== null) {
    const host = originHost(origin);
    if (!host || !requestHosts(request).has(host)) return crossSiteResponse();
  }
  return null;
}

/**
 * 415 unless the body is declared as JSON; otherwise null. Only the media type before any ";" counts, so
 * "text/plain; application/json" (which a browser sends across sites without asking first) is refused.
 */
export function requireJson(request: Request): Response | null {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType === "application/json") return null;
  return Response.json(
    { error: "PackAM couldn’t read that request. Refresh the page and try again.", code: "JSON_REQUIRED" },
    { status: 415 },
  );
}

function crossSiteResponse() {
  return Response.json(
    { error: "This request didn’t come from PackAM, so it was blocked. Refresh the page and try again.", code: "CROSS_SITE_REQUEST" },
    { status: 403 },
  );
}

/** The Origin header's host, or null for "null" and anything that isn't an http(s) origin. */
function originHost(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : null;
  } catch {
    return null;
  }
}

/**
 * Every name this request was addressed to: the proxy's X-Forwarded-Host, the Host header and the request URL
 * (the same headers Next compares for Server Actions). A browser can't set the first two for another site.
 */
function requestHosts(request: Request) {
  const hosts = new Set<string>();
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase();
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (forwarded) hosts.add(forwarded);
  if (host) hosts.add(host);
  try {
    hosts.add(new URL(request.url).host);
  } catch {
    // Not an absolute URL: compare with the headers alone.
  }
  return hosts;
}
