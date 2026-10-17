import { requireRole } from "../../../../../lib/auth-guard";
import { RunnerPrintMissionDetail } from "../../../../../components/runner/RunnerPrintMissionDetail";

export default async function RunnerPrintMissionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("RUNNER", "/runner"); const { id } = await params;
  return <main className="min-h-screen"><div className="packam-container py-10"><p className="text-xs font-black uppercase tracking-widest text-black/40">PackAM Runner · Printing</p><RunnerPrintMissionDetail printJobId={id} /></div></main>;
}
