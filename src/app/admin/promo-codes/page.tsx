import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth-guard";
import { PROMO_CODE_MIGRATION } from "../../../lib/db-errors";
import { loadPromoAdminView } from "../../../lib/promo/promo-admin";
import { PromoCodeManager } from "../../../components/admin/PromoCodeManager";

export const metadata: Metadata = { title: "Promo codes" };

/** Admin → Promo codes: create codes for shop and food checkout, see how often each has been used, pause or resume. */
export default async function AdminPromoCodesPage() {
  await requireRole("ADMIN");
  const view = await loadPromoAdminView();

  return <main className="min-h-screen"><div className="packam-container max-w-3xl py-8">
    <p className="text-xs font-black uppercase tracking-widest text-black/40">Management</p>
    <h1 className="mt-1 text-3xl font-black">Promo codes</h1>
    <p className="mt-2 text-sm text-black/60">Codes students enter at checkout for shop and food orders. A code takes a percentage or a naira amount off the items; the delivery fee is always paid. Uses count only when the payment goes through. Codes can’t be edited after they’re created: pause one and create another.</p>

    {!view.ready && <div role="alert" className="mt-5 rounded-2xl border border-[#c92d24]/25 bg-[#ffe9e7] p-4 text-sm text-[#7a1a14]">
      <p className="font-black">Promo codes activate after the database update</p>
      <p className="mt-1 leading-6">Until migration <code className="font-mono text-xs">{PROMO_CODE_MIGRATION}</code> is applied, codes can’t be created and checkout tells students promo codes aren’t available yet. Checkout without a code works as normal.</p>
    </div>}

    <PromoCodeManager editable={view.ready} codes={view.codes} />
  </div></main>;
}
