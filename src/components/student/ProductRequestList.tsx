"use client";

import { FormEvent, useEffect, useState } from "react";

type ProductRequest = { id: string; requestedName: string; quantity: number; variant: string | null; description: string | null; status: string; createdAt: string; product: { id: string; name: string } | null };
const statusCopy: Record<string, string> = { PENDING: "Request received.", CHECKING: "We’re checking around for it 👀", AVAILABLE: "Found it!", UNAVAILABLE: "We couldn’t find that one this time.", CANCELLED: "Request cancelled." };

export function ProductRequestList({ initialProductName = "" }: { initialProductName?: string }) {
  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [productName, setProductName] = useState(initialProductName); const [quantity, setQuantity] = useState(1); const [variant, setVariant] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => { void fetch("/api/product-requests").then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setRequests(data.requests); }).catch((e) => setError(e.message || "Unable to load requests.")); }, 0); return () => window.clearTimeout(timer); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/product-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productName, quantity, variant, note }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "We couldn’t send that request.");
      setRequests((current) => [{ ...data.request, quantity, variant: variant || null, description: note || null, product: null }, ...current]);
      setProductName(""); setQuantity(1); setVariant(""); setNote(""); setSuccess("Got it. We’ll check around 👀");
    } catch (e) { setError(e instanceof Error ? e.message : "We couldn’t send that request."); } finally { setBusy(false); }
  }
  return (
    <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form
        onSubmit={submit}
        className="h-fit rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7"
      >
        <h2 className="text-xl font-black">Can’t find what you need?</h2>
        <p className="mt-1 text-sm leading-6 text-black/65">
          Tell us what you’re looking for. We’ll check around.
        </p>
        <label className="mt-5 block text-sm font-bold">
          Product name
          <input
            required
            maxLength={120}
            value={productName}
            onChange={(event) => setProductName(event.target.value)}
            placeholder="Scientific Calculator"
            className="mt-1 min-h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-base font-normal outline-none transition placeholder:text-black/60 focus-visible:border-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="min-w-0 text-sm font-bold">
            Quantity
            <input
              required
              type="number"
              min={1}
              max={99}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
              className="mt-1 min-h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-base font-normal outline-none transition focus-visible:border-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            />
          </label>
          <label className="min-w-0 text-sm font-bold">
            Variant (optional)
            <input
              maxLength={120}
              value={variant}
              onChange={(event) => setVariant(event.target.value)}
              placeholder="Casio FX-991ES Plus"
              className="mt-1 min-h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-base font-normal outline-none transition placeholder:text-black/60 focus-visible:border-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm font-bold">
          Additional note (optional)
          <textarea
            maxLength={500}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Any shop around campus is fine."
            className="mt-1 min-h-24 w-full rounded-xl border border-black/15 bg-white px-3 py-3 text-base font-normal outline-none transition placeholder:text-black/60 focus-visible:border-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          />
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {success && <p role="status" className="mt-3 text-sm font-bold text-green-800">{success}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 min-h-12 w-full rounded-xl bg-black px-6 text-base font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
      </form>

      <section aria-labelledby="your-product-requests">
        <h2 id="your-product-requests" className="text-xl font-black">Your requests</h2>
        {requests.length ? (
          <div className="mt-3 space-y-3">
            {requests.map((item) => (
              <article key={item.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <strong className="break-words text-base">{item.requestedName} × {item.quantity}</strong>
                  <span className="w-fit rounded-full bg-[#fff4c7] px-3 py-1 text-sm font-bold text-black/80">
                    {statusCopy[item.status] ?? item.status}
                  </span>
                </div>
                {item.variant && <p className="mt-2 break-words text-sm text-black/65">{item.variant}</p>}
                {item.description && <p className="mt-1 break-words text-sm leading-6 text-black/65">{item.description}</p>}
                {item.status === "AVAILABLE" && item.product && (
                  <a
                    href={`/products/${item.product.id}`}
                    className="mt-2 inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                  >
                    View {item.product.name} →
                  </a>
                )}
                <p className="mt-2 text-xs text-black/60">{new Date(item.createdAt).toLocaleDateString()}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-2xl bg-white p-5 text-sm leading-6 text-black/65">
            No product requests yet. Send us a request above and we’ll check around.
          </p>
        )}
      </section>
    </div>
  );
}
