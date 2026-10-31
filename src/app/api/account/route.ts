import { auth } from "../../../auth";
import { db } from "../../../lib/db";
import { findPendingEmailChange } from "../../../lib/account/account-tokens";
import { AppUrlConfigError, appUrl } from "../../../lib/app-url";
import { isSchemaBehindCode, schemaBehindCodeResponse } from "../../../lib/db-errors";
import { isEmailConfigured } from "../../../lib/email";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The signed-in person's own account, for the settings page (every role). A pending email change is shown in
 * full: it is the owner's own new address. `emailConfigured` is false when emailed links can't go out (no email
 * transport, or no usable APP_URL), so the page can say email changes and confirmation aren't available yet.
 * `canDelete` says whether this kind of account can be deleted here (students only); what might still block it
 * comes from GET /api/account/delete.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to see your account.", code: "SIGN_IN_REQUIRED" }, { status: 401, headers: NO_STORE });

  try {
    const user = await db.user.findFirst({
      where: { id: userId, status: "ACTIVE" },
      select: { firstName: true, lastName: true, email: true, phone: true, role: true, emailVerifiedAt: true, passwordChangedAt: true, createdAt: true },
    });
    if (!user) return Response.json({ error: "Sign in to see your account.", code: "SIGN_IN_REQUIRED" }, { status: 401, headers: NO_STORE });
    const pending = await findPendingEmailChange(db, userId);
    return Response.json({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt,
      role: user.role,
      pendingEmail: pending?.email ?? null,
      pendingEmailExpiresAt: pending?.expiresAt ?? null,
      passwordChangedAt: user.passwordChangedAt,
      emailConfigured: emailLinksAvailable(),
      canDelete: user.role === "STUDENT",
    }, { headers: NO_STORE });
  } catch (error) {
    if (isSchemaBehindCode(error)) return schemaBehindCodeResponse(error, "GET /api/account");
    console.error("ACCOUNT LOAD ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t load your account. Please try again." }, { status: 500, headers: NO_STORE });
  }
}

/** Email can be sent and its links built. */
function emailLinksAvailable() {
  if (!isEmailConfigured()) return false;
  try {
    appUrl("/");
    return true;
  } catch (error) {
    if (!(error instanceof AppUrlConfigError)) throw error;
    console.error("ACCOUNT EMAIL LINKS UNAVAILABLE:", error.name);
    return false;
  }
}
