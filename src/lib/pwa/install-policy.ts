/**
 * When to suggest installing PackAM, and how each browser can install it. Pure, so the rules are unit-tested;
 * the browser reads and writes the stored state.
 *
 * The prompt is a suggestion, never a gate: it only appears on browsing pages, after the visitor has looked
 * around, never while they're checking out, paying or printing, never when PackAM is already installed, and
 * rests for a while after "Maybe later". Installing is always available from the account menu.
 */

export type InstallState = {
  /** Pages viewed in this browser since the first visit (counted once per page change). */
  pageViews: number;
  /** When the visitor first arrived (ms). */
  firstSeenAt: number;
  /** "Maybe later": when, and how many times. */
  dismissedAt: number | null;
  dismissals: number;
  /** The browser confirmed an install (the appinstalled event). */
  installed: boolean;
};

export const EMPTY_INSTALL_STATE: InstallState = { pageViews: 0, firstSeenAt: 0, dismissedAt: null, dismissals: 0, installed: false };

export const MIN_PAGE_VIEWS = 3;
export const MIN_TIME_ON_SITE_MS = 45_000;
export const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
/** After this many "Maybe later"s the prompt stops appearing by itself; the menu entry stays. */
export const MAX_DISMISSALS = 3;

/** Where the prompt may appear: browsing pages only, never in checkout, payment, printing, sign-in or admin. */
export function isPromptPath(path: string) {
  return path === "/" || path === "/search" || path.startsWith("/products/") || path === "/food" || path.startsWith("/food/") || path === "/orders" || path === "/saved";
}

export function shouldAutoPrompt(state: InstallState, context: { now: number; path: string; canInstall: boolean; standalone: boolean; cartCount: number }) {
  if (!context.canInstall || context.standalone || state.installed) return false;
  if (!isPromptPath(context.path)) return false;
  // Someone with items in their cart is on their way to checkout: don't get in the way.
  if (context.cartCount > 0) return false;
  if (state.dismissals >= MAX_DISMISSALS) return false;
  if (state.dismissedAt !== null && context.now - state.dismissedAt < SNOOZE_MS) return false;
  const engaged = state.pageViews >= MIN_PAGE_VIEWS || (state.firstSeenAt > 0 && context.now - state.firstSeenAt >= MIN_TIME_ON_SITE_MS);
  return engaged;
}

export function recordPageView(state: InstallState, now: number): InstallState {
  return { ...state, pageViews: Math.min(state.pageViews + 1, 1000), firstSeenAt: state.firstSeenAt || now };
}

export function recordDismissal(state: InstallState, now: number): InstallState {
  return { ...state, dismissedAt: now, dismissals: state.dismissals + 1 };
}

/** Reads stored state defensively: anything odd falls back to a fresh start. */
export function parseInstallState(raw: string | null): InstallState {
  if (!raw) return EMPTY_INSTALL_STATE;
  try {
    const value = JSON.parse(raw) as Partial<InstallState>;
    const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
    return {
      pageViews: count(value.pageViews),
      firstSeenAt: count(value.firstSeenAt),
      dismissedAt: typeof value.dismissedAt === "number" && Number.isFinite(value.dismissedAt) ? value.dismissedAt : null,
      dismissals: count(value.dismissals),
      installed: value.installed === true,
    };
  } catch {
    return EMPTY_INSTALL_STATE;
  }
}

/**
 * How this browser can install PackAM, from its user agent. Only iPhone and iPad need a guide; everywhere else
 * the browser's own install prompt (beforeinstallprompt) decides, and without it nothing is offered.
 *
 * - "ios-safari": Safari's Share → Add to Home Screen.
 * - "ios-browser": Chrome, Edge or Firefox on iOS 16.4+, which also have Share → Add to Home Screen.
 * - "ios-open-in-safari": an in-app browser (Instagram, Facebook, TikTok…) or an older iOS browser that
 *   can't add to the home screen: the guide's first step is to open PackAM in Safari.
 * - null: not iOS.
 */
export type IosInstallRoute = "ios-safari" | "ios-browser" | "ios-open-in-safari" | null;

export function iosInstallRoute(userAgent: string, platform = "", maxTouchPoints = 0): IosInstallRoute {
  const isIPhoneOrIPad = /iPhone|iPad|iPod/.test(userAgent);
  // iPadOS 13+ says it's a Mac; a Mac with a touch screen is an iPad.
  const isIPadOS = !isIPhoneOrIPad && /Macintosh/.test(userAgent) && (platform === "MacIntel" || platform === "") && maxTouchPoints > 1;
  if (!isIPhoneOrIPad && !isIPadOS) return null;
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|musical_ly|TikTok|Twitter|Snapchat|LinkedInApp|Pinterest|GSA\//.test(userAgent)) return "ios-open-in-safari";
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)) {
    const version = userAgent.match(/OS (\d+)[_.](\d+)/);
    const major = version ? Number(version[1]) : 0;
    const minor = version ? Number(version[2]) : 0;
    return major > 16 || (major === 16 && minor >= 4) ? "ios-browser" : "ios-open-in-safari";
  }
  // Real Safari says "Safari" and "Version/"; other WebKit shells usually don't.
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return "ios-safari";
  return isIPadOS ? "ios-safari" : "ios-open-in-safari";
}
