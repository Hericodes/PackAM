import { requireRole } from "../../../lib/auth-guard";
import { campusDay } from "../../../lib/analytics/range";
import { AnalyticsDashboard } from "../../../components/admin/analytics/AnalyticsDashboard";

type Props = { searchParams: Promise<{ range?: string; from?: string; to?: string }> };

export default async function AdminAnalyticsPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const initial = params.from && params.to ? { from: params.from, to: params.to } : { range: params.range ?? "30d" };
  return (
    <main className="min-h-screen">
      <div className="packam-container py-8">
        <p className="text-xs font-black uppercase tracking-widest text-black/40">Records</p>
        <h1 className="mt-2 text-3xl font-black">Analytics</h1>
        <p className="mt-1 text-sm text-black/55">Visitors, customers, orders and revenue from PackAM’s own records.</p>
        <div className="mt-5"><AnalyticsDashboard initial={initial} today={campusDay(new Date())} /></div>
      </div>
    </main>
  );
}
