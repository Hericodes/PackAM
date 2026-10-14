import { requireRole } from "../../lib/auth-guard";
import Link from "next/link";
import { NotificationBell } from "../../components/notifications/NotificationBell";
import { SignOutButton } from "../../components/auth/SignOutButton";

export default async function RunnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("RUNNER");

  return <><header className="border-b border-black/5 bg-white"><div className="packam-container flex items-center justify-between py-3"><Link href="/runner" className="font-black">PackAM Runner</Link><div className="flex items-center gap-1"><NotificationBell /><SignOutButton /></div></div></header>{children}</>;
}
