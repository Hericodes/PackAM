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
  return <main className="min-h-screen bg-[#f7f5ee]"><div className="packam-container py-8"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-black/40">PackAM updates</p><h1 className="mt-1 text-3xl font-black">Notifications</h1></div>{unread > 0 && <button onClick={() => void mark()} className="text-sm font-bold underline">Mark all read</button>}</div>{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}<div className="mt-5 space-y-3">{items.map((item) => { const href = item.orderId ? role === "ADMIN" ? `/admin/orders/${item.orderId}` : role === "RUNNER" ? `/runner/missions/${item.orderId}` : `/orders/${item.orderId}` : item.relatedType === "PRODUCT_REQUEST" ? "/product-requests" : item.relatedType === "SUPPORT_CASE" ? role === "ADMIN" ? "/admin/support" : "/support" : null; return <article key={item.id} className={`rounded-2xl bg-white p-4 ${item.isRead ? "opacity-65" : "ring-1 ring-[#efce55]"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black">{item.title}</h2><p className="mt-1 text-sm text-black/70">{item.message}</p><p className="mt-2 text-xs text-black/40">{new Date(item.createdAt).toLocaleString()}</p>{href && <Link onClick={() => { if (!item.isRead) void mark(item.id); }} className="mt-2 inline-block text-xs font-bold underline" href={href}>{item.orderId ? "Open order" : item.relatedType === "PRODUCT_REQUEST" ? "View request" : "Open support"}</Link>}</div>{!item.isRead && <button onClick={() => void mark(item.id)} className="text-xs font-bold underline">Mark read</button>}</div></article>; })}{!items.length && !error && <p className="rounded-2xl bg-white p-5 text-sm text-black/50">You’re all caught up.</p>}</div></div></main>;
}
