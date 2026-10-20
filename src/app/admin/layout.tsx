import { requireRole } from "../../lib/auth-guard";
import Link from "next/link";
import { NotificationBell } from "../../components/notifications/NotificationBell";
import { SignOutButton } from "../../components/auth/SignOutButton";
import { AdminNav } from "../../components/admin/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("ADMIN");

  return <div className="pk-theme-ops"><header className="border-b border-black/5 bg-white/90 backdrop-blur"><div className="packam-container flex flex-wrap items-center gap-x-4 gap-y-2 py-3"><Link href="/admin" className="order-1 text-lg font-black">PackAM <span className="text-xs font-bold text-black/40">OPERATIONS</span></Link><div className="order-2 ml-auto flex items-center gap-1 lg:order-3 lg:ml-0"><NotificationBell /><SignOutButton /></div><div className="order-3 w-full lg:order-2 lg:w-auto lg:flex-1"><AdminNav /></div></div></header><div className="pk-ops-main">{children}</div></div>;
}
