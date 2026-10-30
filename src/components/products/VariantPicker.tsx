"use client";

import { useMemo, useState } from "react";
import { AddToCart } from "./AddToCart";
import { isBuyable, selectableValues, variantFor, type ShopOption, type ShopVariant } from "../../lib/products/variants";

/**
 * Options for a product with variants. Values that can't lead to a buyable variant are disabled, the price and
 * stock follow the chosen variant, and "Add to cart" only works once every option is chosen. The server
 * checks the variant, its price and its stock again; nothing here is trusted.
 */
export function VariantPicker({ productId, options, variants, fromPrice }: { productId: string; options: ShopOption[]; variants: ShopVariant[]; fromPrice: number }) {
  // A single value with a buyable variant is chosen for the student.
  const [selection, setSelection] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    for (const option of options) {
      const buyable = option.values.filter((value) => variants.some((variant) => isBuyable(variant) && variant.valueIds.includes(value.id)));
      if (option.values.length === 1 && buyable.length === 1) start[option.id] = buyable[0].id;
    }
    return start;
  });
  const selectable = useMemo(() => selectableValues(options, variants, selection), [options, variants, selection]);
  const chosen = variantFor(options, variants, selection);
  const missing = options.find((option) => !selection[option.id]);
  const anyBuyable = variants.some(isBuyable);

  function choose(optionId: string, valueId: string) {
    setSelection((current) => {
      const next = { ...current, [optionId]: current[optionId] === valueId ? "" : valueId };
      // Drop other choices that no longer fit with this one.
      for (const option of options) {
        if (option.id === optionId || !next[option.id]) continue;
        const fits = variants.some((variant) => isBuyable(variant) && variant.valueIds.includes(next[option.id]) && (!next[optionId] || variant.valueIds.includes(next[optionId])));
        if (!fits) next[option.id] = "";
      }
      return next;
    });
  }

  const blockedReason = !anyBuyable
    ? "Sold out"
    : missing
      ? `Choose ${missing.name.toLowerCase()}`
      : !chosen || !isBuyable(chosen)
        ? "Not available"
        : null;

  return (
    <div>
      <p className="text-3xl font-black">
        {chosen ? `₦${chosen.price.toLocaleString()}` : <><span className="text-base font-bold text-black/60">From </span>₦{fromPrice.toLocaleString()}</>}
      </p>
      {chosen?.stockQuantity !== null && chosen?.stockQuantity !== undefined && (
        <p className={`mt-1 text-sm font-bold ${chosen.stockQuantity > 0 ? "text-black/65" : "text-red-700"}`} aria-live="polite">
          {chosen.stockQuantity > 0 ? (chosen.stockQuantity <= 5 ? `Only ${chosen.stockQuantity} left` : "In stock") : "Sold out"}
        </p>
      )}

      <div className="mt-4 grid gap-4">
        {options.map((option) => (
          <fieldset key={option.id}>
            <legend className="text-sm font-extrabold">
              {option.name}
              {selection[option.id] && <span className="font-semibold text-black/60">: {option.values.find((value) => value.id === selection[option.id])?.value}</span>}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {option.values.map((value) => {
                const active = selection[option.id] === value.id;
                const available = selectable[option.id]?.has(value.id) ?? false;
                return (
                  <button
                    key={value.id}
                    type="button"
                    onClick={() => choose(option.id, value.id)}
                    disabled={!available && !active}
                    aria-pressed={active}
                    className={`min-h-10 rounded-full border px-4 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:border-dashed disabled:text-black/35 disabled:line-through ${active ? "border-black bg-black text-white" : "border-black/20 bg-white hover:border-black"}`}
                  >
                    {value.value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-5">
        <AddToCart key={chosen?.id ?? "none"} productId={productId} variantId={chosen && isBuyable(chosen) ? chosen.id : null} blockedReason={blockedReason} maxQuantity={chosen?.stockQuantity ?? null} />
      </div>
    </div>
  );
}
