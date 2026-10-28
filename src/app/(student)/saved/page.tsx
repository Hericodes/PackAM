import type { Metadata } from "next";
import { SavedProducts } from "../../../components/products/SavedProducts";

export const metadata: Metadata = { title: "Saved items" };

export default function SavedPage() {
  return (
    <main className="min-h-screen pb-16">
      <div className="packam-container pb-8 pt-3 sm:py-10">
        <p className="pk-eyebrow">Your list</p>
        <h1 className="pk-page-title mt-1 max-sm:text-[1.625rem] sm:mt-2">Saved items</h1>
        <p className="pk-muted mt-1.5 max-w-xl text-[0.8125rem] leading-5 sm:mt-2 sm:text-base sm:leading-6">
          Items you save are kept on this device only. Prices below are always the current prices.
        </p>
        <SavedProducts />
      </div>
    </main>
  );
}
