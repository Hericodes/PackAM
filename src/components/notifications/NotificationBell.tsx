"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";

/** Fired by the notifications page after marking something read, so the badge updates at once. */
export const NOTIFICATIONS_CHANGED = "packam:notifications-changed";
/** How often the badge re-counts while the tab is open and visible. */
const REFRESH_MS = 60_000;

export function NotificationBell() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/notifications?count=1", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.unreadCount === "number") setCount(data.unreadCount);
    } catch {
      // Offline or a blip: keep the last count and try again on the next tick.
    } finally {
      inFlight.current = false;
    }
  }, []);

  // On load and on every page change (an action elsewhere may have created or read one).
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [pathname, refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onChanged = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
    };
  }, [refresh]);

  const active = pathname === "/notifications";
  return (
    <Link
      href="/notifications"
      data-tip="Notifications"
      aria-current={active ? "page" : undefined}
      aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
      className={`pk-tip relative flex h-11 w-11 items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${active ? "bg-black text-[#feb80a]" : "text-black/75 hover:bg-[#fff4c7] hover:text-black"}`}
    >
      <Icon name="bell" />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#c92d24] px-1 text-[11px] font-black leading-none text-white ring-2 ring-[#fffdf7]">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
