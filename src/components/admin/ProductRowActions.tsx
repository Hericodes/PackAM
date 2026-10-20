"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = {
  product: { id: string; name: string; status: "ACTIVE" | "INACTIVE" };
  /** Server-side reason a delete would be refused, shown before the admin tries. The server re-checks. */
  deleteBlockedReason: string | null;
  /** Why the product can't be activated yet (e.g. no price). The server enforces the same rule. */
  activationBlockedReason?: string | null;
};

const smallButton = "inline-flex min-h-10 items-center justify-center rounded-full px-4 text-xs font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Edit, activate/deactivate and delete for one product. Deactivating and deleting are separate
 * controls with separate wording, so hiding a product can never be mistaken for removing it.
 */
export function ProductRowActions({ product, deleteBlockedReason, activationBlockedReason = null }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"status" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = `delete-product-${product.id}`;

  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && busy !== "delete") setConfirming(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, busy]);

  async function toggleStatus() {
    if (busy) return;
    setBusy("status"); setError("");
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The status couldn’t be changed.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The status couldn’t be changed.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteProduct() {
    if (busy) return; // one request at a time, however many clicks
    setBusy("delete"); setError("");
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The product couldn’t be deleted.");
      setConfirming(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The product couldn’t be deleted.");
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <Link href={`/admin/products/${product.id}/edit`} className={`${smallButton} border border-black/10 hover:border-black/25`}>Edit</Link>
        <button type="button" onClick={() => void toggleStatus()} disabled={busy !== null || activationBlockedReason !== null} title={activationBlockedReason ?? undefined} className={`${smallButton} border border-black/10 hover:border-black/25`}>
          {busy === "status" ? "Saving…" : product.status === "ACTIVE" ? "Deactivate" : "Activate"}
        </button>
        <button
          type="button"
          onClick={() => { setError(""); setConfirming(true); }}
          disabled={busy !== null || deleteBlockedReason !== null}
          title={deleteBlockedReason ?? undefined}
          aria-describedby={deleteBlockedReason ? `${titleId}-blocked` : undefined}
          className={`${smallButton} border border-[#c92d24]/30 text-[#c92d24] hover:bg-[#ffe9e7]`}
        >
          Delete
        </button>
      </div>
      {activationBlockedReason && <p className="max-w-xs text-left text-[0.6875rem] leading-4 text-[#a15c00] sm:text-right">{activationBlockedReason} Use Edit to add it.</p>}
      {deleteBlockedReason && <p id={`${titleId}-blocked`} className="max-w-xs text-left text-[0.6875rem] leading-4 text-black/50 sm:text-right">{deleteBlockedReason.split(". ")[0]}.</p>}
      {error && <p role="alert" className="max-w-xs text-left text-xs font-semibold leading-5 text-[#c92d24] sm:text-right">{error}</p>}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={(event) => { if (event.target === event.currentTarget && busy !== "delete") setConfirming(false); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-body`} className="w-full max-w-md rounded-3xl bg-white p-6 text-left shadow-xl">
            <h2 id={titleId} className="text-lg font-black">Delete “{product.name}”?</h2>
            <div id={`${titleId}-body`} className="mt-2 space-y-2 text-sm leading-6 text-black/70">
              <p>This permanently removes the product, its shop sources and their price history. It can’t be undone.</p>
              <p>It will also be removed from any student’s cart. Past orders are not affected — products with order history can’t be deleted.</p>
              <p>To only hide it from students, cancel and use <strong>Deactivate</strong> instead.</p>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={cancelRef} type="button" onClick={() => setConfirming(false)} disabled={busy === "delete"} className={`${smallButton} min-h-11 border border-black/15`}>Keep product</button>
              <button type="button" onClick={() => void deleteProduct()} disabled={busy === "delete"} aria-busy={busy === "delete"} className={`${smallButton} min-h-11 bg-[#c92d24] text-white hover:bg-[#a8241d]`}>
                {busy === "delete" ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
