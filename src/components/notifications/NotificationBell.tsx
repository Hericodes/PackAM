"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "../ui/Icon";

export function NotificationBell() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    void fetch("/api/notifications").then((r) => r.ok ? r.json() : null).then((data) => { if (live && data) setCount(data.unreadCount); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
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
        <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#feb80a] px-1 text-[11px] font-black leading-none text-black ring-2 ring-[#fffdf7]">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
