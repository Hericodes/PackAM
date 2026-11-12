import { requireRole } from "../../lib/auth-guard";
import Link from "next/link";
import { NotificationBell } from "../../components/notifications/NotificationBell";
import { SignOutButton } from "../../components/auth/SignOutButton";
import { Icon } from "../../components/ui/Icon";

export default async function RunnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Admins come here in runner mode ("Deliver orders"), so they get a way back to the dashboard.
  const session = await requireRole("RUNNER");
  const isAdmin = session.user.role === "ADMIN";

  return (
    <div className="pk-theme-ops">
      <header className="border-b border-black/5 bg-white/90 backdrop-blur">
        <div className="packam-container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link href="/runner" className="font-black">PackAM Runner</Link>
            {isAdmin && <Link href="/admin" className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-bold text-black/70 transition hover:bg-black/10 hover:text-black">← Admin</Link>}
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            {/* Name, email, password and devices: the Settings page every role shares. */}
            <Link
              href="/settings"
              aria-label="Settings"
              data-tip="Settings"
              className="pk-tip flex h-11 w-11 items-center justify-center rounded-full text-black/75 transition hover:bg-packam-yellow-light hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              <Icon name="settings" />
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
