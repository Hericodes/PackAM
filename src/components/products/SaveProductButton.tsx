"use client";

import { useSavedProducts } from "./useSavedProducts";
import { Icon } from "../ui/Icon";

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
      className={`flex h-11 w-11 items-center justify-center rounded-full border shadow-[0_4px_12px_-6px_rgba(8,8,8,0.35)] backdrop-blur-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-60 ${
        saved ? "border-black bg-black text-[#feb80a]" : "border-white/80 bg-white/90 text-black/80 hover:border-black/20 hover:text-black"
      }`}
    >
      <Icon name="heart" filled={saved} className="h-5 w-5" strokeWidth={2} />
    </button>
  );
}
