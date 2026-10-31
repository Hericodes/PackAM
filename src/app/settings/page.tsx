import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DeleteAccountSection } from "../../components/account/DeleteAccountSection";
import { DevicesSection } from "../../components/account/DevicesSection";
import { EmailChangeNotice } from "../../components/account/EmailChangeNotice";
import { EmailSection } from "../../components/account/EmailSection";
import { NotificationsSection } from "../../components/account/NotificationsSection";
import { PasswordSection } from "../../components/account/PasswordSection";
import { ProfileSection } from "../../components/account/ProfileSection";
import { isEmailChangeStatus, linkExpiryLabel } from "../../components/account/account-requests";
import { emailLinksAvailable } from "../../components/account/email-links";
import { FormAlert } from "../../components/auth/FormAlert";
import { PackAMLogo } from "../../components/brand/PackAMLogo";
import { Icon } from "../../components/ui/Icon";
import { findPendingEmailChange } from "../../lib/account/account-tokens";
import { requireAuth } from "../../lib/auth-guard";
import { roleHome } from "../../lib/auth-redirect";
import { db } from "../../lib/db";
import { isSchemaBehindCode, missingSchemaElement } from "../../lib/db-errors";

export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

type SettingsPageProps = { searchParams: Promise<{ email?: string | string[] }> };
type Role = "STUDENT" | "RUNNER" | "ADMIN";

type Account = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: Role;
  emailVerified: boolean;
  pendingEmail: string | null;
  pendingExpires: string | null;
  passwordChanged: string | null;
  memberSince: string;
};

type Loaded = { kind: "ready"; account: Account } | { kind: "missing" } | { kind: "updating" };

/** The back link goes to each role's own home. */
const HOMES: Record<Role, { name: string; back: string }> = {
  STUDENT: { name: "PackAM home", back: "Back to PackAM" },
  RUNNER: { name: "Runner hub", back: "Back to Runner hub" },
  ADMIN: { name: "Operations", back: "Back to Operations" },
};

/**
 * Account settings for every role (students, runners and admins; only students can delete their account here):
 * profile, email and its verification, password, devices, notifications. Read straight from the database for the
 * signed-in person, the same fields GET /api/account answers; each section then talks to its /api/account route.
 * It has its own simple header, so it works the same whichever area the person came from.
 *
 * /settings?email=… shows the result of a "confirm your new email" link, and survives a trip through log in.
 */
export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.email) ? params.email[0] : params.email;
  const emailStatus = isEmailChangeStatus(requested) ? requested : null;
  const returnTo = emailStatus ? `/settings?email=${emailStatus}` : "/settings";
  const session = await requireAuth(returnTo);
  const userId = session.user.id;
  // Never query without an id: Prisma would drop the condition and find somebody else's account.
  if (!userId) redirect(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);

  const loaded = await loadAccount(userId);
  if (loaded.kind === "missing") redirect(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);
  const role: Role = loaded.kind === "ready" ? loaded.account.role : session.user.role;
  const emailAvailable = loaded.kind === "ready" && emailLinksAvailable();

  return (
    <main className="pk-theme-auth min-h-svh pb-[max(4rem,env(safe-area-inset-bottom))]">
      <header className="border-b border-black/6 bg-packam-cream/80 backdrop-blur-md">
        <div className="packam-container flex h-16 max-w-2xl items-center justify-between gap-3 md:h-[72px]">
          <Link
            href={roleHome(role)}
            aria-label={HOMES[role].name}
            className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
          >
            <PackAMLogo width={76} className="md:w-[84px]" />
          </Link>
          <Link href={roleHome(role)} className="pk-btn pk-btn-secondary">
            <Icon name="arrowLeft" className="h-4 w-4" />
            {HOMES[role].back}
          </Link>
        </div>
      </header>

      <div className="packam-container max-w-2xl pt-7 sm:pt-10">
        <p className="pk-eyebrow">Your account</p>
        <h1 className="pk-page-title mt-2">Settings</h1>
        <p className="mt-2 text-[0.9375rem] leading-6 text-black/65">Your profile, sign-in and privacy, in one place.</p>

        {loaded.kind === "updating" ? (
          <FormAlert tone="error" title="Settings are being updated" className="mt-6">
            PackAM is being updated, so your settings can’t be shown right now. Nothing has changed. Please try again in a few minutes.
          </FormAlert>
        ) : (
          <>
            {emailStatus && <EmailChangeNotice status={emailStatus} email={loaded.account.email} />}
            <div className="mt-6 space-y-4 sm:space-y-5">
              <ProfileSection
                firstName={loaded.account.firstName}
                lastName={loaded.account.lastName}
                email={loaded.account.email}
                phone={loaded.account.phone}
                role={role}
                memberSince={loaded.account.memberSince}
              />
              <EmailSection
                email={loaded.account.email}
                verified={loaded.account.emailVerified}
                pendingEmail={loaded.account.pendingEmail}
                pendingExpires={loaded.account.pendingExpires}
                emailAvailable={emailAvailable}
                supportAvailable={role !== "ADMIN"}
              />
              <PasswordSection
                email={loaded.account.email}
                names={[loaded.account.firstName, loaded.account.lastName].filter(Boolean)}
                lastChanged={loaded.account.passwordChanged}
                resetAvailable={emailAvailable}
              />
              <DevicesSection email={loaded.account.email} />
              <NotificationsSection role={role} />
              {role === "STUDENT" && <DeleteAccountSection email={loaded.account.email} />}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/** Dates in campus time, so the server's own timezone never shows. */
function campusDate(date: Date, options: Intl.DateTimeFormatOptions) {
  return date.toLocaleDateString("en-GB", { ...options, timeZone: "Africa/Lagos" });
}

/** The signed-in person's active account, or why it can't be shown (gone or no longer active; database not migrated yet). */
async function loadAccount(userId: string): Promise<Loaded> {
  try {
    const [user, pending] = await Promise.all([
      db.user.findFirst({
        where: { id: userId, status: "ACTIVE" },
        select: { firstName: true, lastName: true, email: true, phone: true, role: true, emailVerifiedAt: true, passwordChangedAt: true, createdAt: true },
      }),
      findPendingEmailChange(db, userId),
    ]);
    if (!user) return { kind: "missing" };
    return {
      kind: "ready",
      account: {
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        email: user.email,
        phone: user.phone,
        role: user.role,
        emailVerified: user.emailVerifiedAt !== null,
        pendingEmail: pending?.email ?? null,
        // Formatted here: the browser would format it in its own build of the date rules, and the page would differ.
        pendingExpires: pending ? linkExpiryLabel(pending.expiresAt) : null,
        passwordChanged: user.passwordChangedAt ? campusDate(user.passwordChangedAt, { day: "numeric", month: "short", year: "numeric" }) : null,
        memberSince: campusDate(user.createdAt, { month: "long", year: "numeric" }),
      },
    };
  } catch (error) {
    if (!isSchemaBehindCode(error)) throw error;
    console.error(`SCHEMA BEHIND CODE in settings page: the database is missing ${missingSchemaElement(error)}. Apply the pending Prisma migrations (npx prisma migrate deploy) to this database.`);
    return { kind: "updating" };
  }
}
