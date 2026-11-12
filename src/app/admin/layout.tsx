import { requireAdminAccess } from "../../lib/admin/admin-access";
import { AdminShell } from "../../components/admin/AdminShell";
import { auth } from "../../auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The admin's level decides the menu (normal admins don't see the super admin's pages); every page and API checks again.
  const access = await requireAdminAccess();
  const session = await auth();

  return <AdminShell name={session?.user.name?.trim() || "Admin"} level={access.level}>{children}</AdminShell>;
}
