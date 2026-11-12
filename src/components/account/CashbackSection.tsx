import Link from "next/link";
import { SettingsSection } from "./SettingsSection";
import { cashbackEntryLabel } from "../../lib/cashback/cashback-rules";
import type { CashbackHistoryEntry } from "../../lib/cashback/cashback-store";

const naira = (amount: number) => `₦${Math.abs(amount).toLocaleString("en-NG")}`;
const campusDay = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });

/**
 * Settings → Cashback (students): the balance, how it's earned and used, and recent changes. Server-rendered from the
 * database; the balance is used at checkout.
 */
export function CashbackSection({ balance, entries, earning }: { balance: number; entries: CashbackHistoryEntry[]; earning: { enabled: boolean; ratePercent: number; welcomeBonus: number } }) {
  return (
    <SettingsSection id="cashback" icon="wallet" title="Cashback" description="Money back on your orders, to spend on your next one.">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-[#1f1300] p-4 text-white">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-[#feb80a]">Your balance</p>
          <p className="mt-1 text-3xl font-black tracking-tight">{naira(balance)}</p>
        </div>
        {balance > 0 && <Link href="/food" className="rounded-full bg-[#feb80a] px-4 py-2 text-sm font-black text-black transition hover:bg-[#ffc933]">Use it on food</Link>}
      </div>
      <p className="mt-3 text-sm leading-6 text-black/65">
        {earning.enabled && earning.ratePercent > 0
          ? `You get ${earning.ratePercent}% back on what you pay for items, once each order or print job is delivered${earning.welcomeBonus > 0 ? `, plus a ${naira(earning.welcomeBonus)} welcome bonus after your first delivery` : ""}. `
          : ""}
        At checkout, your cashback comes off your items. Delivery is always paid.
      </p>
      {entries.length > 0 && (
        <ul className="mt-4 divide-y divide-black/5" aria-label="Recent cashback">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block font-semibold">{cashbackEntryLabel(entry.kind, entry.note)}</span>
                <span className="block text-xs text-black/50">{campusDay(entry.createdAt)}{entry.returned ? " · payment didn’t go through, so it came back" : ""}</span>
              </span>
              <span className={`shrink-0 font-black tabular-nums ${entry.returned ? "text-black/35 line-through" : entry.amount > 0 ? "text-[#16803c]" : "text-black/70"}`}>{entry.amount > 0 ? "+" : "−"}{naira(entry.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
