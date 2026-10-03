"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function NotificationBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    void fetch("/api/notifications").then((r) => r.ok ? r.json() : null).then((data) => { if (live && data) setCount(data.unreadCount); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return (
    <Link
      href="/notifications"
      aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
      className="relative flex h-10 w-10 items-center justify-center rounded-xl text-black/75 transition hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
      {count > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#feb80a] px-1 text-[9px] font-bold leading-none text-black">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
