import Link from "next/link";
import { requireRole } from "../../../lib/auth-guard";
import { DELIVERY_TIER_MIGRATION } from "../../../lib/db-errors";
import { loadDeliveryTierAdminView } from "../../../lib/delivery-tier-admin";
import { fallbackQuoteSet, formatEta, quoteFor } from "../../../lib/delivery-tiers";
import { PRINT_DELIVERY_FEE } from "../../../lib/printing/pricing";
import { formatNaira } from "../../../lib/products/product-form";
import { DeliveryTierSettings } from "../../../components/admin/DeliveryTierSettings";

/** Admin → Delivery tiers: price and switch for each marketplace and food delivery speed, plus recent changes. */
export default async function AdminDeliveryTiersPage() {
  await requireRole("ADMIN");
  const view = await loadDeliveryTierAdminView();
  // What checkout offers until the tier tables exist.
  const fallback = quoteFor(fallbackQuoteSet(), "CRUISE");

  return <main className="min-h-screen"><div className="packam-container max-w-3xl py-8">
    <p className="text-xs font-black uppercase tracking-widest text-black/40">Management</p>
    <h1 className="mt-1 text-3xl font-black">Delivery tiers</h1>
    <p className="mt-2 text-sm text-black/60">Prices and switches for Cruise Mode, Sharp Sharp and Oya Now! on marketplace and food orders. Changes apply to the next checkout. Paid orders keep the speed, window and fee they were charged. Delivery windows and descriptions are fixed.</p>

    {!view.ready && <div role="alert" className="mt-5 rounded-2xl border border-[#c92d24]/25 bg-[#ffe9e7] p-4 text-sm text-[#7a1a14]">
      <p className="font-black">Tier pricing activates after the database update</p>
      <p className="mt-1 leading-6">Until migration <code className="font-mono text-xs">{DELIVERY_TIER_MIGRATION}</code> is applied, checkout offers {fallback.label} only ({formatNaira(fallback.fee ?? 0)}, {formatEta(fallback.etaMinMinutes, fallback.etaMaxMinutes)}), Sharp Sharp and Oya Now! aren’t available, and edits are refused. No settings were changed.</p>
    </div>}

    <DeliveryTierSettings editable={view.ready} tiers={view.tiers} />

    <p className="mt-4 rounded-2xl bg-white p-4 text-sm"><strong>Printing delivery: {formatNaira(PRINT_DELIVERY_FEE)}</strong> <span className="text-black/60">(fixed; not affected by these settings)</span></p>

    <section aria-labelledby="tier-history" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tier-history" className="text-xl font-black">Recent changes</h2>
        <Link href="/admin/audit" className="text-sm font-bold underline">Full audit log</Link>
      </div>
      {view.history.length ? <ul className="mt-3 grid gap-2">{view.history.map((entry) => <li key={entry.id} className="rounded-2xl bg-white p-4">
        <p className="font-black">{entry.summary}</p>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-black/50">Before: </dt><dd className="inline font-semibold">{entry.before ?? "not recorded"}</dd></div>
          <div><dt className="inline text-black/50">After: </dt><dd className="inline font-semibold">{entry.after ?? "not recorded"}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-black/55">By {entry.adminName}{entry.adminName !== entry.adminEmail ? ` (${entry.adminEmail})` : ""} · {entry.atLabel}</p>
      </li>)}</ul> : <p className="mt-3 rounded-2xl bg-white p-5 text-sm text-black/55">No changes yet. Every change to a fee or switch is listed here with the admin who made it.</p>}
    </section>
  </div></main>;
}
