import { requireRole } from "../../../../../lib/auth-guard";
import { RunnerMissionDetail } from "../../../../../components/runner/RunnerMissionDetail";

export default async function RunnerMissionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("RUNNER", "/runner"); const { id } = await params;
  return <main className="min-h-screen bg-[#fffdf7]"><div className="packam-container py-10"><p className="text-xs font-black uppercase tracking-widest text-black/40">PackAM Runner</p><RunnerMissionDetail orderId={id} /></div></main>;
}
