import "server-only";

import { AppUrlConfigError, appUrl } from "../../lib/app-url";
import { isEmailConfigured } from "../../lib/email";

let reported = false;

/**
 * Whether PackAM can email someone a link right now: an email transport is set up and APP_URL can build the
 * link. GET /api/account answers the same thing as `emailConfigured`. Pages use it to offer only what can work:
 * no "send a new link" button, and no email change, while email can't go out.
 */
export function emailLinksAvailable(): boolean {
  if (!isEmailConfigured()) return false;
  try {
    appUrl("/");
    return true;
  } catch (error) {
    if (!(error instanceof AppUrlConfigError)) throw error;
    // Said once per server process: the account routes report it on every request already.
    if (!reported) {
      reported = true;
      console.error("ACCOUNT EMAIL LINKS UNAVAILABLE:", error.name);
    }
    return false;
  }
}
