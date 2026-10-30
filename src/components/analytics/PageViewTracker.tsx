"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Sends one anonymous page view per page change (see lib/analytics/tracking.ts). Changing only the query
 * string (search terms, filters) is not a new page. The visitor id is random and kept in this browser; a
 * session ends after 30 minutes without a page view. Nothing is sent for Do Not Track / Global Privacy
 * Control, or on staff pages.
 */
const VISITOR_KEY = "packam:vid";
const SESSION_KEY = "packam:session";
const SESSION_IDLE_MS = 30 * 60 * 1000;

// Module scope: survives re-renders and React's development double effects, resets on a real page load.
let lastPath: string | null = null;
let memoryVisitor: string | null = null;
let memorySession: { id: string; last: number } | null = null;

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function visitorId() {
  try {
    const stored = window.localStorage.getItem(VISITOR_KEY);
    if (stored) return stored;
    const id = newId();
    window.localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return (memoryVisitor ??= newId());
  }
}

function sessionId(now: number) {
  let session: { id: string; last: number } | null = memorySession;
  try { session = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null"); } catch { /* storage blocked: memory only */ }
  if (!session || typeof session.id !== "string" || typeof session.last !== "number" || now - session.last > SESSION_IDLE_MS) session = { id: newId(), last: now };
  session = { id: session.id, last: now };
  memorySession = session;
  try { window.localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* memory only */ }
  return session.id;
}

function optedOut() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

export function PageViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname === lastPath) return;
    lastPath = pathname;
    if (optedOut() || /^\/(admin|runner)(\/|$)/.test(pathname)) return;
    const body = JSON.stringify({ viewId: newId(), visitorId: visitorId(), sessionId: sessionId(Date.now()), path: pathname, referrer: document.referrer || null });
    const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/analytics/pageview", new Blob([body], { type: "application/json" }));
    if (!sent) void fetch("/api/analytics/pageview", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => { /* analytics never interrupts browsing */ });
  }, [pathname]);
  return null;
}
