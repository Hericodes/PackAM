import type { Metadata } from "next";
import { SavedProducts } from "../../../components/products/SavedProducts";

export const metadata: Metadata = { title: "Saved items" };

export default function SavedPage() {
  return (
    <main className="min-h-screen pb-16">
      <div className="packam-container py-7 sm:py-10">
        <p className="pk-eyebrow">Your list</p>
        <h1 className="pk-page-title mt-2">Saved items</h1>
        <p className="pk-muted mt-2 max-w-xl text-sm leading-6 sm:text-base">
          Items you save are kept on this device only. Prices below are always the current prices.
        </p>
        <SavedProducts />
      </div>
    </main>
  );
}
