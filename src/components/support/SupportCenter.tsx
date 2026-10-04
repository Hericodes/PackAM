"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type CaseRow = { id: string; subject: string; description: string; status: string; resolution: string | null; orderId: string | null; createdAt: string };

export function SupportCenter() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/support");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load your support requests.");
    setCases(data.cases);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((e) => setError(e.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, description, orderId: orderId.trim() || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to contact PackAM.");
      setSubject("");
      setDescription("");
      setOrderId("");
      setNotice("Got it. PackAM operations will take a look.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to contact PackAM.");
    } finally {
      setBusy(false);
    }
  }

  const fieldClassName =
    "w-full rounded-xl border border-black/15 bg-white px-4 py-3.5 text-base text-black outline-none transition placeholder:text-black/60 focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black/20";

  return (
    <main className="min-h-screen bg-[#f7f5ee]">
      <div className="packam-container py-8 sm:py-10">
        <header className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wider text-black/55">We’re here to help</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Support</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-black/65 sm:text-base">
            Tell us what happened and we’ll look into it.
          </p>
        </header>

        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm sm:p-6">
          <div>
            <label htmlFor="support-subject" className="mb-1.5 block text-sm font-bold">What do you need help with?</label>
            <input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              minLength={4}
              maxLength={120}
              placeholder="e.g. An issue with my delivery"
              className={fieldClassName}
            />
          </div>
          <div>
            <label htmlFor="support-order" className="mb-1.5 block text-sm font-bold">Order reference <span className="font-normal text-black/55">(optional)</span></label>
            <input
              id="support-order"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              maxLength={64}
              placeholder="Enter your order reference"
              className={fieldClassName}
            />
          </div>
          <div>
            <label htmlFor="support-description" className="mb-1.5 block text-sm font-bold">A few details</label>
            <textarea
              id="support-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={10}
              maxLength={3000}
              rows={5}
              placeholder="Share a little more so we can help."
              className={`${fieldClassName} resize-y`}
            />
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">{notice}</p>}
          <button
            type="submit"
            disabled={busy}
            className="min-h-12 w-full rounded-xl bg-black px-6 py-3 text-base font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {busy ? "Sending…" : "Send to PackAM"}
          </button>
        </form>

        <section aria-labelledby="support-requests-heading" className="mt-8 sm:mt-10">
          <h2 id="support-requests-heading" className="text-xl font-black sm:text-2xl">Your requests</h2>
          <div className="mt-3 space-y-3">
            {cases.map((item) => (
              <article key={item.id} className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <h3 className="break-words text-base font-black sm:text-lg">{item.subject}</h3>
                  <span className="w-fit rounded-full bg-[#f7f5ee] px-3 py-1 text-xs font-bold capitalize text-black/70">
                    {item.status.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-black/75">{item.description}</p>
                {item.resolution && (
                  <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-[#fff8df] p-3 text-sm leading-6 text-black/80">
                    {item.resolution}
                  </p>
                )}
                <p className="mt-3 break-words text-xs leading-5 text-black/55">
                  {new Date(item.createdAt).toLocaleString()}{item.orderId ? ` · Order ${item.orderId}` : ""}
                </p>
              </article>
            ))}
            {!cases.length && (
              <p className="rounded-2xl bg-white p-5 text-sm leading-6 text-black/65 shadow-sm">
                No support requests yet. Send us a message above if you need a hand.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
