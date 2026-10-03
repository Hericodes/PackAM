import { AdminSupport } from "../../../components/admin/AdminSupport";
import { db } from "../../../lib/db";

export default async function AdminSupportPage() {
  const cases = await db.supportCase.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS", "ESCALATED"] } }, orderBy: { createdAt: "asc" }, take: 100, select: { id: true, subject: true, description: true, status: true, resolution: true, orderId: true, createdAt: true, user: { select: { firstName: true, lastName: true, email: true } } } });
  return <main className="min-h-screen bg-[#f7f5ee]"><div className="packam-container py-8"><h1 className="text-3xl font-black">Support cases</h1><p className="mt-2 text-sm text-black/55">Student issues awaiting review. Progress and resolution changes are audited.</p><AdminSupport cases={cases} /></div></main>;
}
