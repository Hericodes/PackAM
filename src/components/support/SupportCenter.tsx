"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { shortReference } from "../../lib/student-copy";
import { SUPPORT_CATEGORIES, SUPPORT_SUBJECT_MAX, supportStatusLabel } from "../../lib/support-policy";
import { Icon } from "../ui/Icon";

type CaseRow = { id: string; subject: string; description: string; status: string; resolution: string | null; orderId: string | null; createdAt: string };
type OrderOption = { id: string; label: string };

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-[#fff4c7] text-[#6b4700]",
  IN_PROGRESS: "bg-[#e8f3fb] text-[#1769aa]",
  ESCALATED: "bg-[#ffe9e7] text-[#c92d24]",
  RESOLVED: "bg-[#e9f8ee] text-[#16803c]",
  CLOSED: "bg-black/5 text-black/65",
};

const LONGEST_CATEGORY_LABEL = SUPPORT_CATEGORIES.reduce((longest, item) => (item.label.length > longest.length ? item.label : longest), "");

/**
 * `orders` is the signed-in student's own order list (null for runners, who quote an order reference instead).
 */
export function SupportCenter({ orders, initialOrderId }: { orders: OrderOption[] | null; initialOrderId: string }) {
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [category, setCategory] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [orderId, setOrderId] = useState(initialOrderId);
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
      void load().catch((e) => {
        setCases([]);
        setError(e.message);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Keep "Category: summary" inside the stored subject limit, assuming the longest label until one is picked.
  const categoryLabel = SUPPORT_CATEGORIES.find((item) => item.value === category)?.label ?? LONGEST_CATEGORY_LABEL;
  const summaryMax = SUPPORT_SUBJECT_MAX - categoryLabel.length - 2;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!category) {
      setError("Choose what the issue is about.");
      return;
    }
    if (description.trim().length < 10) {
      setError("Add a little more detail (at least 10 characters) so the team can help.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject: summary.trim(), description: description.trim(), orderId: orderId.trim() || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to contact PackAM.");
      setCategory("");
      setSummary("");
      setDescription("");
      setOrderId("");
      setNotice("Sent. Your request is saved below, and you’ll get a notification when the team updates it.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to contact PackAM.");
    } finally {
      setBusy(false);
    }
  }

  const fieldClassName =
    "w-full rounded-xl border border-black/15 bg-white px-4 py-3.5 text-base text-black outline-none transition placeholder:text-black/55 focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black/20";

  return (
    <main className="min-h-screen pb-16">
      <div className="packam-container py-8 sm:py-10">
        <header className="mb-6 flex items-start gap-4">
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-black text-[#feb80a] sm:flex" aria-hidden="true">
            <Icon name="help" className="h-6 w-6" />
          </span>
          <div>
            <p className="pk-eyebrow">We dey here for you</p>
            <h1 className="pk-page-title mt-1">Help &amp; support</h1>
            <p className="pk-muted mt-2 max-w-xl text-sm leading-6 sm:text-base">
              Report a problem with an order — missing or wrong items, damage, delivery or payment — or ask us anything else. The PackAM team reviews every request.
            </p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
          <form onSubmit={submit} noValidate className="pk-card space-y-5 p-4 sm:p-6" aria-labelledby="support-form-heading">
            <h2 id="support-form-heading" className="text-lg font-black">New request</h2>

            <fieldset>
              <legend className="mb-2 block text-sm font-bold">What is it about?</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SUPPORT_CATEGORIES.map((item) => (
                  <label
                    key={item.value}
                    className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border px-2 text-center text-sm font-bold transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-black ${
                      category === item.value ? "border-black bg-black text-white" : "border-black/12 bg-white text-black/80 hover:border-black/30"
                    }`}
                  >
                    <input type="radio" name="support-category" value={item.value} checked={category === item.value} onChange={() => setCategory(item.value)} className="sr-only" />
                    {item.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="support-order" className="mb-1.5 block text-sm font-bold">Related order <span className="font-normal text-black/60">(optional)</span></label>
              {orders ? (
                <div className="relative">
                  <select id="support-order" value={orderId} onChange={(e) => setOrderId(e.target.value)} className={`${fieldClassName} appearance-none pr-11`}>
                    <option value="">Not about a specific order</option>
                    {orders.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
                  </select>
                  <Icon name="chevronDown" className="pointer-events-none absolute right-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-black/55" />
                </div>
              ) : (
                <input id="support-order" value={orderId} onChange={(e) => setOrderId(e.target.value)} maxLength={64} placeholder="Order ID" className={fieldClassName} />
              )}
              {orders && orders.length === 0 && <p className="pk-muted mt-1.5 text-xs">You don’t have any orders yet.</p>}
            </div>

            <div>
              <label htmlFor="support-subject" className="mb-1.5 block text-sm font-bold">Short summary <span className="font-normal text-black/60">(optional)</span></label>
              <input id="support-subject" value={summary} onChange={(e) => setSummary(e.target.value.slice(0, summaryMax))} maxLength={summaryMax} placeholder="e.g. Only got 2 of the 3 notebooks" className={fieldClassName} />
            </div>

            <div>
              <label htmlFor="support-description" className="mb-1.5 block text-sm font-bold">What happened?</label>
              <textarea
                id="support-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={10}
                maxLength={3000}
                rows={5}
                aria-describedby="support-description-help"
                placeholder="Tell us what went wrong and what you expected."
                className={`${fieldClassName} resize-y`}
              />
              <p id="support-description-help" className="pk-muted mt-1.5 flex justify-between text-xs"><span>At least 10 characters.</span><span>{description.length}/3000</span></p>
            </div>

            {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>}
            {notice && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">{notice}</p>}
            <button type="submit" disabled={busy} className="pk-btn pk-btn-primary pk-btn-lg w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-50">
              <Icon name="message" className="h-4 w-4" /> {busy ? "Sending…" : "Send to PackAM"}
            </button>
          </form>

          <section aria-labelledby="support-requests-heading">
            <h2 id="support-requests-heading" className="pk-section-title">Your requests</h2>
            <p className="pk-muted mt-1 text-sm">Statuses update here as the team works on them.</p>
            <div className="mt-3 space-y-3">
              {cases === null && <p className="pk-card p-5 text-sm text-black/60">Loading your requests…</p>}
              {cases?.map((item) => (
                <article key={item.id} className="pk-card p-4 sm:p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <h3 className="break-words text-base font-black">{item.subject}</h3>
                    <span className={`w-fit shrink-0 rounded-full px-3 py-1 text-xs font-bold ${STATUS_STYLES[item.status] ?? STATUS_STYLES.CLOSED}`}>
                      {supportStatusLabel(item.status)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-black/75">{item.description}</p>
                  {item.resolution && (
                    <div className="mt-3 rounded-xl border border-[#f0dfaa] bg-[#fff8df] p-3 text-sm leading-6 text-black/80">
                      <p className="text-xs font-black uppercase tracking-wider text-[#875a00]">PackAM response</p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{item.resolution}</p>
                    </div>
                  )}
                  <p className="pk-muted mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
                    <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}</time>
                    {item.orderId && (
                      <>
                        <span aria-hidden="true">·</span>
                        {orders ? (
                          <Link href={`/orders/${item.orderId}`} className="font-bold text-black underline underline-offset-2">Order {shortReference(item.orderId)}</Link>
                        ) : (
                          <span>Order {shortReference(item.orderId)}</span>
                        )}
                      </>
                    )}
                  </p>
                </article>
              ))}
              {cases?.length === 0 && (
                <p className="pk-card p-5 text-sm leading-6 text-black/65">No support requests yet. If anything no go well, send one with the form — we go sort am.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
