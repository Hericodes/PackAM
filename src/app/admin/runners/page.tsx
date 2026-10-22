import { db } from "../../../lib/db";
import { requireRole } from "../../../lib/auth-guard";
import { runnerAdminActions } from "../../../lib/runners/runner-access";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { RunnerVerificationActions } from "../../../components/admin/RunnerVerificationActions";

export default async function AdminRunnersPage() {
  await requireRole("ADMIN");
  // Every RUNNER account, including ones whose runner profile was never set up.
  const runners = await db.user.findMany({
    where: { role: "RUNNER" },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true, status: true, role: true,
      runnerProfile: {
        select: {
          id: true, isAvailable: true, isVerified: true, totalDeliveries: true, completedDeliveries: true,
          assignedOrders: { where: { status: { in: ["RUNNER_ASSIGNED", "SOURCING_PRODUCT", "OUT_FOR_DELIVERY"] } }, select: { id: true, status: true, deliveryAddress: true } },
          payouts: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, amount: true, reference: true } },
        },
      },
    },
  });
  const needsSetup = runners.filter((r) => !r.runnerProfile).length;

  return <main className="min-h-screen"><div className="packam-container py-8">
    <p className="text-xs font-black uppercase tracking-widest text-black/40">People</p>
    <h1 className="mt-1 text-3xl font-black">Runners</h1>
    <p className="mt-2 text-sm text-black/55">Every runner account · set-up, verification, active assignments, delivery counts and payouts. Only verified runners can go available and receive missions.</p>
    {needsSetup > 0 && <p role="status" className="mt-4 rounded-2xl bg-[#fff3d6] p-4 text-sm text-[#6b4700]"><strong>{needsSetup} runner {needsSetup === 1 ? "account needs" : "accounts need"} set-up.</strong> They can sign in but see “still being set up” until you set them up and verify them below.</p>}
    <div className="mt-5 grid gap-3">{runners.map((r) => {
      const profile = r.runnerProfile;
      const actions = runnerAdminActions({ role: r.role, status: r.status, profile: profile && { isAvailable: profile.isAvailable, isVerified: profile.isVerified } });
      const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email;
      return <section key={r.id} className="rounded-2xl bg-white p-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div className="min-w-0"><p className="font-black">{name}</p><p className="text-xs text-black/50">{r.email} · {r.phone ?? "No phone"} · account {r.status.toLowerCase()}</p></div>
          <div className="flex flex-wrap gap-2">
            {!profile ? <StatusBadge label="Set-up needed" tone="warning" /> : <>
              <StatusBadge label={profile.isVerified ? "Verified" : "Unverified"} tone={profile.isVerified ? "success" : "neutral"} />
              <StatusBadge label={profile.isAvailable ? "Available" : "Offline"} tone={profile.isAvailable ? "info" : "neutral"} />
            </>}
          </div>
        </div>
        <RunnerVerificationActions userId={r.id} name={name} setupNeeded={actions.setupNeeded} canVerify={actions.canVerify} canUnverify={actions.canUnverify} />
        {profile && <>
          <p className="mt-3 text-sm">Completed: {profile.completedDeliveries} · Total deliveries: {profile.totalDeliveries}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div><p className="text-xs font-black uppercase text-black/40">Active assignments</p>{profile.assignedOrders.map((o) => <p key={o.id} className="mt-1 text-sm">{o.status} · {o.deliveryAddress}</p>)}{!profile.assignedOrders.length && <p className="mt-1 text-sm text-black/45">None</p>}</div>
            <div><p className="text-xs font-black uppercase text-black/40">Recent payouts</p>{profile.payouts.map((p) => <p key={p.id} className="mt-1 text-sm">{p.status} · ₦{p.amount.toLocaleString()} · {p.reference ?? "no reference"}</p>)}{!profile.payouts.length && <p className="mt-1 text-sm text-black/45">No payout records</p>}</div>
          </div>
        </>}
      </section>;
    })}{!runners.length && <p className="rounded-2xl bg-white p-5 text-sm text-black/50">No runner accounts yet.</p>}</div>
  </div></main>;
}
