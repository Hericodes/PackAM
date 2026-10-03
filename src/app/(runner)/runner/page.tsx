import { requireRole } from "../../../lib/auth-guard";
import { RunnerMissionBoard } from "../../../components/runner/RunnerMissionBoard";
import { auth } from "../../../auth";

export default async function RunnerHomePage() {
  await requireRole("RUNNER", "/runner");
  const session = await auth();
  const adminView = session?.user.role === "ADMIN";
  return <main className="min-h-screen bg-[#fffdf7]"><div className="packam-container py-10"><p className="text-xs font-black uppercase tracking-widest text-black/40">{adminView ? "PackAM Operations" : "PackAM Runner"}</p><h1 className="mt-2 text-3xl font-black">{adminView ? "Active runner missions" : "Delivery missions"}</h1><RunnerMissionBoard adminView={adminView} /></div></main>;
}
