import { requireRole } from "../../lib/auth-guard";
import { AdminShell } from "../../components/admin/AdminShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("ADMIN");

  return <AdminShell name={session.user.name?.trim() || "Admin"}>{children}</AdminShell>;
}
