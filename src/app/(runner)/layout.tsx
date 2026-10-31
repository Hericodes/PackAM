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
  await requireRole("RUNNER");

  return (
    <div className="pk-theme-ops">
      <header className="border-b border-black/5 bg-white/90 backdrop-blur">
        <div className="packam-container flex items-center justify-between py-3">
          <Link href="/runner" className="font-black">PackAM Runner</Link>
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
