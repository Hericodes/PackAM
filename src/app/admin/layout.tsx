import { requireRole } from "../../lib/auth-guard";
import Link from "next/link";
import { NotificationBell } from "../../components/notifications/NotificationBell";
import { SignOutButton } from "../../components/auth/SignOutButton";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("ADMIN");

  return <><header className="border-b border-black/5 bg-white"><div className="packam-container flex flex-wrap items-center justify-between gap-3 py-4"><Link href="/admin" className="text-lg font-black">PackAM <span className="text-xs font-bold text-black/40">OPERATIONS</span></Link><nav aria-label="Operations" className="-mx-1 flex w-full gap-1 overflow-x-auto whitespace-nowrap text-sm font-bold lg:w-auto lg:flex-wrap">{[["/admin","Overview"],["/admin/orders","Orders"],["/admin/print-jobs","Print jobs"],["/admin/exceptions","Exceptions"],["/admin/requests","Requests"],["/admin/support","Support"],["/admin/payments","Payments"],["/admin/finance","Finance"],["/admin/vendors","Vendors"],["/admin/runners","Runners"],["/admin/products","Products"],["/admin/categories","Categories"],["/admin/audit","Audit log"],["/search","Marketplace"],["/runner","Runner view"],["/notifications","Updates"]].map(([href,label])=><Link key={href} href={href} className="rounded-full px-3 py-2 hover:bg-black/5">{label}</Link>)}</nav><div className="flex items-center gap-1"><NotificationBell /><SignOutButton /></div></div></header>{children}</>;
}
