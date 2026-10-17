"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../ui/Icon";
import { isNavItemActive, type NavItem } from "./nav-items";

export function StudentNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="hidden md:block">
      <ul className="flex items-center gap-0.5 rounded-full border border-black/[0.07] bg-white/75 p-1 shadow-[0_1px_2px_rgba(8,8,8,0.04)]">
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black lg:px-4 ${
                  active ? "bg-black text-white shadow-sm" : "text-black/70 hover:bg-[#fff4c7] hover:text-black"
                }`}
              >
                <Icon name={item.icon} className={`h-[18px] w-[18px] ${active ? "text-[#feb80a]" : ""}`} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
