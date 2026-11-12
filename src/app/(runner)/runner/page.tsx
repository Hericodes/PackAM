import { requireRole } from "../../../lib/auth-guard";
import { RunnerMissionBoard } from "../../../components/runner/RunnerMissionBoard";

type Props = { searchParams: Promise<{ view?: string }> };

/**
 * Runners' missions. Admins land here too: on its own it is their runner mode ("Deliver orders": go available, get
 * offers, deliver), and with ?view=all it is the operations view of every runner's offers and deliveries.
 */
export default async function RunnerHomePage({ searchParams }: Props) {
  const session = await requireRole("RUNNER", "/runner");
  const isAdmin = session.user.role === "ADMIN";
  const allMissions = isAdmin && (await searchParams).view === "all";
  return <main className="min-h-screen"><div className="packam-container py-10"><p className="text-xs font-black uppercase tracking-widest text-black/40">{allMissions ? "PackAM Operations" : isAdmin ? "Admin · runner mode" : "PackAM Runner"}</p><h1 className="mt-2 text-3xl font-black">{allMissions ? "Active runner missions" : isAdmin ? "Deliver orders" : "Delivery missions"}</h1>{isAdmin && !allMissions && <p className="mt-2 max-w-xl text-sm leading-6 text-black/60">Go available to get new orders like a runner. Accept one, pick it up and deliver it here. Go offline when you’re done.</p>}<RunnerMissionBoard adminView={allMissions} /></div></main>;
}
