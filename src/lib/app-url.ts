/**
 * Absolute links for emails and anything else that leaves the site. Built only from APP_URL, never from
 * siteConfig.url (hard-coded localhost) or request headers (which the caller chooses). APP_URL is required and
 * must use HTTPS in production, the same rules as the payment return URLs. Pure apart from reading the
 * environment when appUrl() is called, so it is unit-tested.
 */

/** APP_URL is missing or unusable. The message names the problem, never the value. */
export class AppUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppUrlConfigError";
  }
}

/** Checks an APP_URL value and returns it as a URL, or throws AppUrlConfigError. */
export function parseAppUrl(value: string | undefined, nodeEnv: string | undefined): URL {
  const raw = value?.trim();
  if (!raw) throw new AppUrlConfigError("APP_URL is required to build links in emails.");
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new AppUrlConfigError("APP_URL must be an absolute URL, like https://your-packam-domain.example.");
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new AppUrlConfigError("APP_URL must start with https:// (or http:// outside production).");
  if (base.username || base.password) throw new AppUrlConfigError("APP_URL must not contain a username or password.");
  if (base.protocol !== "https:" && nodeEnv === "production") throw new AppUrlConfigError("APP_URL must use HTTPS in production.");
  return base;
}

/**
 * An internal path ("/reset-password?token=…") on the base URL's origin. Anything that isn't a plain
 * internal path is refused, so a link can never point at another site.
 */
export function buildAppUrl(base: URL, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Links can only be built from an internal path such as /settings.");
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("Links can only be built from an internal path such as /settings.");
  return url.toString();
}

/** The absolute URL of an internal path, on APP_URL. Throws AppUrlConfigError when APP_URL isn't usable. */
export function appUrl(path: string): string {
  return buildAppUrl(parseAppUrl(process.env.APP_URL, process.env.NODE_ENV), path);
}
