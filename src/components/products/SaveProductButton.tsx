"use client";

import { useSavedProducts } from "./useSavedProducts";

export function SaveProductButton({ productId, productName, variant = "icon" }: { productId: string; productName: string; variant?: "icon" | "full" }) {
  const { ready, isSaved, toggle } = useSavedProducts();
  const saved = ready && isSaved(productId);
  const label = saved ? `Remove ${productName} from saved` : `Save ${productName} for later`;

  if (variant === "full") {
    return (
      <button type="button" onClick={() => toggle(productId)} disabled={!ready} aria-pressed={saved} className="pk-btn pk-btn-secondary">
        <span aria-hidden="true">{saved ? "♥" : "♡"}</span>
        {saved ? "Saved" : "Save for later"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => toggle(productId)}
      disabled={!ready}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg shadow-sm transition ${saved ? "border-black bg-black text-white" : "border-black/10 bg-white/95 text-black hover:border-black/30"}`}
    >
      <span aria-hidden="true">{saved ? "♥" : "♡"}</span>
    </button>
  );
}
