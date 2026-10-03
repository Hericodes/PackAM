import { requireRole } from "../../lib/auth-guard";
import Link from "next/link";
import { NotificationBell } from "../../components/notifications/NotificationBell";

export default async function RunnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("RUNNER");

  return <><header className="border-b border-black/5 bg-white"><div className="packam-container flex items-center justify-between py-3"><Link href="/runner" className="font-black">PackAM Runner</Link><NotificationBell /></div></header>{children}</>;
}
