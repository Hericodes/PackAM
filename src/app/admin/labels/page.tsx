import { db } from "../../../lib/db";
import { requireRole } from "../../../lib/auth-guard";
import { AdminLabels } from "../../../components/admin/AdminLabels";

export default async function AdminLabelsPage() {
  await requireRole("ADMIN");
  const labels = await db.productLabel.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true, sortOrder: true, _count: { select: { products: true } } } });
  return <main className="min-h-screen"><div className="packam-container max-w-3xl py-8"><h1 className="text-3xl font-black">Product labels</h1><AdminLabels labels={labels} /></div></main>;
}
