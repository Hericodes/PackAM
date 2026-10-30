"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Operations navigation grouped by task. Every destination is still protected by its own page and API checks. */
export const ADMIN_NAV_GROUPS = [
  { label: "Daily ops", links: [["/admin", "Overview"], ["/admin/orders", "Orders"], ["/admin/print-jobs", "Print jobs"], ["/admin/exceptions", "Exceptions"], ["/admin/payments", "Payments"]] },
  { label: "Catalogue", links: [["/admin/products", "Products"], ["/admin/food", "Food"], ["/admin/categories", "Categories"], ["/admin/labels", "Labels"], ["/admin/vendors", "Vendors"], ["/admin/requests", "Requests"]] },
  { label: "People", links: [["/admin/runners", "Runners"], ["/admin/support", "Support"]] },
  { label: "Records", links: [["/admin/analytics", "Analytics"], ["/admin/finance", "Finance"], ["/admin/audit", "Audit log"]] },
  { label: "Other views", links: [["/search", "Marketplace"], ["/runner", "Runner view"], ["/notifications", "Updates"]] },
] as const;

function isActive(href: string, pathname: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // On a phone the tabs scroll sideways: bring the current page's tab into view.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
  }, [pathname]);
  return (
    // "relative" makes the strip contain its absolutely positioned screen-reader labels. Without it they escape
    // the scroll area and stretch the whole page to the strip's full width on phones.
    <nav ref={navRef} aria-label="Operations" className="relative -mx-4 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
      <ul className="flex w-max items-center gap-1 text-sm font-bold lg:w-auto lg:flex-wrap">
        {ADMIN_NAV_GROUPS.map((group, groupIndex) => (
          <li key={group.label} className="flex items-center gap-1">
            {groupIndex > 0 && <span aria-hidden="true" className="mx-1 h-5 w-px bg-black/10" />}
            <span className="sr-only">{group.label}:</span>
            <span aria-hidden="true" className="hidden px-1 text-[0.625rem] font-black uppercase tracking-wider text-black/35 xl:inline">{group.label}</span>
            <ul className="flex items-center gap-1">
              {group.links.map(([href, label]) => {
                const active = isActive(href, pathname);
                return (
                  <li key={href}>
                    <Link href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-3 ${active ? "bg-black text-white" : "hover:bg-black/5"}`}>{label}</Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
