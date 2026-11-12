import type { Metadata } from "next";
import { db } from "../../../lib/db";
import { requireAdminAccess } from "../../../lib/admin/admin-access";
import { CASHBACK_MIGRATION, cashbackTablesReady, readCashbackSettings } from "../../../lib/cashback/cashback-store";
import { CashbackManager } from "../../../components/admin/CashbackManager";

export const metadata: Metadata = { title: "Cashback" };
export const dynamic = "force-dynamic";

/** Admin → Cashback: the earning rules, and one student's balance with add / take away. */
export default async function AdminCashbackPage() {
  await requireAdminAccess("/admin/cashback");
  const ready = await cashbackTablesReady(db);
  const settings = ready ? await readCashbackSettings(db) : null;
  return (
    <main className="min-h-screen">
      <div className="packam-container max-w-3xl py-8">
        <p className="text-xs font-black uppercase tracking-widest text-black/40">Management</p>
        <h1 className="mt-1 text-3xl font-black">Cashback</h1>
        <p className="mt-2 text-sm leading-6 text-black/60">
          Students get a % back on what they pay for items, once an order or print job is delivered, plus an optional welcome bonus after their first delivery. They spend it at shop and food checkout, on items only (delivery is always paid).
        </p>
        {settings ? <CashbackManager initial={settings} /> : (
          <p role="status" className="mt-5 rounded-2xl bg-[#fff3d6] p-4 text-sm font-semibold text-[#6b4700]">Cashback isn’t set up on this database yet. It turns on once migration {CASHBACK_MIGRATION} is applied.</p>
        )}
      </div>
    </main>
  );
}
