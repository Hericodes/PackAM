import { requireRole } from "../../lib/auth-guard";
import Link from "next/link";
import { NotificationBell } from "../../components/notifications/NotificationBell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("ADMIN");

  return <><header className="border-b border-black/5 bg-white"><div className="packam-container flex flex-wrap items-center justify-between gap-3 py-4"><Link href="/admin" className="text-lg font-black">PackAM <span className="text-xs font-bold text-black/40">OPERATIONS</span></Link><nav className="flex flex-wrap gap-2 text-sm font-bold">{[["/admin","Overview"],["/admin/orders","Orders"],["/admin/exceptions","Exceptions"],["/admin/requests","Requests"],["/admin/support","Support"],["/admin/payments","Payments"],["/admin/finance","Finance"],["/admin/vendors","Vendors"],["/admin/runners","Runners"],["/admin/products","Products"],["/admin/categories","Categories"],["/admin/audit","Audit log"],["/search","Marketplace"],["/runner","Runner view"],["/notifications","Updates"]].map(([href,label])=><Link key={href} href={href} className="rounded-full px-3 py-2 hover:bg-black/5">{label}</Link>)}</nav><NotificationBell /></div></header>{children}</>;
}
