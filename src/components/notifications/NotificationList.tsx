"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import { fullTime, groupByDay, notificationActionLabel, notificationHref, notificationLook, relativeTime, type NotificationRole } from "../../lib/notification-display";
import { NOTIFICATIONS_CHANGED } from "./NotificationBell";

type Entry = { id: string; type: string; title: string; message: string; orderId: string | null; relatedType: string | null; relatedId: string | null; isRead: boolean; createdAt: string };
type Filter = "all" | "unread";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

/** Tells the bell to recount straight away instead of on its next check. */
function announceChange() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

export function NotificationList({ role }: { role: NotificationRole }) {
  const [items, setItems] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  // Re-read every minute so "5 min ago" stays true while the page is open.
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t load your notifications.");
      setItems(data.notifications);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t load your notifications.");
    } finally {
      setLoaded(true);
      setNow(new Date());
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    // New ones arrive while the tab is in the background: refresh when the student comes back to it.
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(first); window.clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  async function mark(id?: string) {
    const before = items;
    // Optimistic: it reads as read at once; put back if the server says no.
    setItems((current) => current.map((entry) => !id || entry.id === id ? { ...entry, isRead: true } : entry));
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : { all: true }) });
      if (!response.ok) throw new Error();
      announceChange();
    } catch {
      setItems(before);
      setError("We couldn’t update your notifications. Please try again.");
    }
  }

  const unread = items.filter((entry) => !entry.isRead).length;
  const shown = filter === "unread" ? items.filter((entry) => !entry.isRead) : items;
  const groups = useMemo(() => groupByDay(shown, now), [shown, now]);

  return (
    <main className="min-h-screen">
      <div className="packam-container max-w-3xl py-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="pk-eyebrow">PackAM updates</p>
            <h1 className="pk-page-title mt-1">Notifications</h1>
            <p className="mt-2 text-sm text-black/65" aria-live="polite">
              {!loaded ? "Loading your updates…" : unread ? `${unread} unread ${unread === 1 ? "update" : "updates"}` : "You’re all caught up."}
            </p>
          </div>
          {unread > 0 && (
            <button type="button" onClick={() => void mark()} className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-black/15 bg-white px-4 text-sm font-bold transition hover:border-black/30 ${focusRing}`}>
              <Icon name="check" className="h-4 w-4" strokeWidth={2.6} /> Mark all as read
            </button>
          )}
        </header>

        <div role="tablist" aria-label="Show" className="mt-5 inline-flex rounded-full border border-black/10 bg-white p-1">
          {(["all", "unread"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={`min-h-9 rounded-full px-4 text-sm font-bold transition ${focusRing} ${filter === value ? "bg-black text-white" : "text-black/65 hover:text-black"}`}
            >
              {value === "all" ? "All" : `Unread${unread ? ` (${unread})` : ""}`}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#ffe9e7] px-4 py-3 text-sm font-medium text-[#7a1a14]">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className={`min-h-9 rounded-full bg-white px-3 text-xs font-black ${focusRing}`}>Try again</button>
          </div>
        )}

        {!loaded && (
          <ul aria-hidden="true" className="mt-5 overflow-hidden rounded-2xl border border-black/10 bg-white">
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex gap-3 border-b border-black/[0.06] p-4 last:border-0">
                <div className="pk-skeleton h-10 w-10 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2"><div className="pk-skeleton h-4 w-2/5" /><div className="pk-skeleton h-3 w-4/5" /></div>
              </li>
            ))}
          </ul>
        )}

        {loaded && !error && shown.length === 0 && (
          <div className="mt-5 flex flex-col items-center rounded-2xl border border-black/10 bg-white px-6 py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4c7] text-[#7a4a00]"><Icon name="bell" /></span>
            <p className="mt-4 text-base font-black">{filter === "unread" && items.length ? "No unread updates" : "No notifications yet"}</p>
            <p className="mt-1 max-w-xs text-sm leading-6 text-black/60">{filter === "unread" && items.length ? "You don see everything 🙌" : "Updates about your orders, payments and deliveries go show here."}</p>
          </div>
        )}

        {groups.map(({ group, items: entries }) => (
          <section key={group} aria-labelledby={`group-${group}`} className="mt-6">
            <h2 id={`group-${group}`} className="mb-2 px-1 text-xs font-black uppercase tracking-[0.1em] text-black/50">{group}</h2>
            <ul className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_1px_2px_rgba(8,8,8,0.04)]">
              {entries.map((item) => {
                const look = notificationLook(item.type);
                const href = notificationHref(item, role);
                const action = notificationActionLabel(href);
                const at = new Date(item.createdAt);
                const body = (
                  <>
                    <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${look.tile}`} aria-hidden="true">
                      <Icon name={look.icon} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className={`break-words text-[0.9375rem] leading-5 ${item.isRead ? "font-bold text-black/80" : "font-black text-black"}`}>
                          <span className="sr-only">{item.isRead ? "" : "Unread. "}{look.label}: </span>{item.title}
                        </p>
                        <time dateTime={item.createdAt} title={fullTime(at)} className="shrink-0 whitespace-nowrap pt-0.5 text-xs text-black/50">{relativeTime(at, now)}</time>
                      </div>
                      <p className={`mt-1 line-clamp-3 whitespace-pre-line break-words text-sm leading-5 ${item.isRead ? "text-black/55" : "text-black/75"}`}>{item.message}</p>
                      {action && <p className="mt-2 inline-flex items-center gap-1 text-xs font-black text-black/70">{action}<Icon name="chevronRight" className="h-3.5 w-3.5" strokeWidth={2.6} /></p>}
                    </div>
                    {!item.isRead && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#feb80a] ring-4 ring-[#fff4c7]" aria-hidden="true" />}
                  </>
                );
                const rowClass = `flex w-full gap-3 p-4 text-left transition ${item.isRead ? "bg-white" : "bg-[#fffbea]"}`;
                return (
                  <li key={item.id} className="border-b border-black/[0.06] last:border-0">
                    {href ? (
                      <Link href={href} onClick={() => { if (!item.isRead) void mark(item.id); }} className={`${rowClass} hover:bg-[#fff6d6] ${focusRing} focus-visible:-outline-offset-2`}>{body}</Link>
                    ) : item.isRead ? (
                      <div className={rowClass}>{body}</div>
                    ) : (
                      <button type="button" onClick={() => void mark(item.id)} aria-label={`${item.title}. Mark as read`} className={`${rowClass} hover:bg-[#fff6d6] ${focusRing} focus-visible:-outline-offset-2`}>{body}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {loaded && items.length >= 50 && <p className="mt-4 text-center text-xs text-black/50">Showing your latest 50 notifications.</p>}
      </div>
    </main>
  );
}
