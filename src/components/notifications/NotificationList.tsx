"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Entry = { id: string; type: string; title: string; message: string; orderId: string | null; relatedType: string | null; relatedId: string | null; isRead: boolean; createdAt: string };

export function NotificationList({ role }: { role: "STUDENT" | "RUNNER" | "ADMIN" }) {
  const [items, setItems] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/notifications");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load updates.");
    setItems(data.notifications);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((e) => setError(e.message)); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function mark(id?: string) {
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : { all: true }) });
    if (!response.ok) { setError("We couldn't update your notifications."); return; }
    setItems((current) => current.map((entry) => !id || entry.id === id ? { ...entry, isRead: true } : entry));
  }
  const unread = items.filter((entry) => !entry.isRead).length;
  return (
    <main className="min-h-screen bg-[#f7f5ee]">
      <div className="packam-container py-8 sm:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-black/55">PackAM updates</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Notifications</h1>
            <p className="mt-2 text-sm text-black/65">
              {unread ? `${unread} unread ${unread === 1 ? "update" : "updates"}` : "You’re up to date."}
            </p>
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void mark()}
              className="min-h-11 w-full rounded-xl border border-black/15 bg-white px-4 py-2 text-sm font-bold underline underline-offset-2 transition hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto"
            >
              Mark all read
            </button>
          )}
        </header>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>}
        <section aria-label="Your notifications" className="mt-5 space-y-3">
          {items.map((item) => {
            const href = item.orderId
              ? role === "ADMIN"
                ? `/admin/orders/${item.orderId}`
                : role === "RUNNER"
                  ? `/runner/missions/${item.orderId}`
                  : `/orders/${item.orderId}`
              : item.relatedType === "PRODUCT_REQUEST"
                ? "/product-requests"
                : item.relatedType === "SUPPORT_CASE"
                  ? role === "ADMIN" ? "/admin/support" : "/support"
                  : null;

            return (
              <article
                key={item.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm sm:p-5 ${
                  item.isRead ? "border-black/5" : "border-[#e8c238] sm:border-2"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-base font-black sm:text-lg">{item.title}</h2>
                      {!item.isRead && (
                        <span className="rounded-full bg-[#fff3bf] px-2.5 py-1 text-xs font-bold text-black">
                          New
                        </span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-black/75">{item.message}</p>
                    <time dateTime={item.createdAt} className="mt-2 block text-xs leading-5 text-black/55">
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                    {href && (
                      <Link
                        onClick={() => { if (!item.isRead) void mark(item.id); }}
                        className="mt-3 inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                        href={href}
                      >
                        {item.orderId ? "Open order" : item.relatedType === "PRODUCT_REQUEST" ? "View request" : "Open support"}
                      </Link>
                    )}
                  </div>
                  {!item.isRead && (
                    <button
                      type="button"
                      onClick={() => void mark(item.id)}
                      aria-label={`Mark ${item.title} as read`}
                      className="min-h-11 w-full rounded-xl border border-black/15 px-4 py-2 text-sm font-bold transition hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {!items.length && !error && (
            <p className="rounded-2xl bg-white p-5 text-sm leading-6 text-black/65 shadow-sm">
              You’re all caught up. New updates will show up here.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
