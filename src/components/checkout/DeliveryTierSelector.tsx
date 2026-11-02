"use client";

import { formatEta, type DeliveryTierCode, type DeliveryTierQuote } from "../../lib/delivery-tiers";
import { visibleDeliveryTiers } from "../../lib/checkout-delivery-step";

const money = (amount: number) => `₦${amount.toLocaleString()}`;

/**
 * Checkout's delivery-speed choice. One native radio per speed, so it is a real radio group: Tab lands on the
 * chosen speed, arrow keys move between speeds, and screen readers announce the label, fee, window and description.
 * Speeds on sale are listed; a chosen speed that stopped being available stays listed, chosen and disabled, with a
 * note, so the student's choice never changes silently. Prices are the server's; nothing here computes a fee.
 */
export function DeliveryTierSelector({ tiers, selected, onSelect, disabled = false }: {
  tiers: DeliveryTierQuote[];
  selected: DeliveryTierCode | null;
  onSelect: (tier: DeliveryTierCode) => void;
  disabled?: boolean;
}) {
  const visible = visibleDeliveryTiers(tiers, selected);
  if (!visible.length) {
    return <p className="rounded-2xl border border-[#c92d24]/20 bg-[#ffe9e7] p-3.5 text-sm font-semibold text-[#a3241c]">Delivery isn’t available right now. Please try again later. Nothing has been charged.</p>;
  }
  return (
    <fieldset>
      <legend className="sr-only">Choose a delivery speed</legend>
      <div className="grid gap-2">
        {visible.map((tier) => {
          const chosen = selected === tier.tier;
          const choosable = tier.available && !disabled;
          const id = `delivery-tier-${tier.tier.toLowerCase()}`;
          return (
            <label key={tier.tier} className={`flex min-h-14 items-start gap-3 rounded-2xl border bg-white p-3 ${choosable ? "cursor-pointer" : "cursor-not-allowed"} ${chosen ? "border-black ring-1 ring-black" : "border-black/10"}`}>
              {/*
                Named by its label and fee only; the window, description and any note are its description, read once.
                A chosen speed that went off is aria-disabled, not disabled: a checked radio that is disabled makes
                Chrome and Safari skip the whole group on Tab, so keyboard users couldn't reach another speed. It
                can't be chosen again anyway: once the student picks another speed it is no longer listed.
              */}
              <input
                type="radio"
                name="delivery-tier"
                value={tier.tier}
                checked={chosen}
                onChange={() => { if (tier.available) onSelect(tier.tier); }}
                disabled={disabled || (!tier.available && !chosen)}
                aria-disabled={!tier.available || undefined}
                aria-labelledby={`${id}-name ${id}-fee`}
                aria-describedby={`${id}-details`}
                className={`mt-0.5 h-5 w-5 shrink-0 accent-black${tier.available ? "" : " opacity-50"}`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span id={`${id}-name`} className="font-black leading-5">{tier.label}</span>
                  <span id={`${id}-fee`} className="text-sm font-black">{tier.available && tier.fee !== null ? money(tier.fee) : "Not available"}</span>
                </span>
                <span id={`${id}-details`} className="mt-0.5 block text-sm leading-5 text-black/65">
                  <span className="font-semibold text-black/80">{formatEta(tier.etaMinMinutes, tier.etaMaxMinutes)}</span> · {tier.description}
                  {!tier.available && <span className="mt-1 block font-semibold text-[#c92d24]">{tier.label} isn’t available right now. Choose another speed.</span>}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
