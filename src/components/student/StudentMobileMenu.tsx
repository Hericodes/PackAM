"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/Icon";
import { isNavItemActive, type NavItem } from "./nav-items";
import { SignOutRow } from "./StudentProfileMenu";

type MenuUser = { displayName: string; initial: string; roleLabel: string } | null;

export function StudentMobileMenu({ user, primary, secondary }: { user: MenuUser; primary: NavItem[]; secondary: NavItem[] }) {
  const pathname = usePathname();
  // Remember which page the sheet was opened on: navigating elsewhere closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const isOpen = openedOn === pathname;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenedOn(null);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const close = () => setOpenedOn(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={isOpen ? "Close menu" : "Open menu"}
        aria-expanded={isOpen}
        aria-controls="student-mobile-menu"
        onClick={() => setOpenedOn(isOpen ? null : pathname)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-black shadow-[0_1px_2px_rgba(8,8,8,0.04)] transition hover:border-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black md:hidden"
      >
        <Icon name={isOpen ? "close" : "menu"} />
      </button>

      {isOpen &&
        createPortal(
          <div className="fixed inset-x-0 bottom-0 top-16 z-40 md:hidden">
            <button type="button" aria-label="Close menu" tabIndex={-1} onClick={close} className="absolute inset-0 h-full w-full cursor-default bg-black/25 backdrop-blur-[2px]" />
            <div
              ref={panelRef}
              id="student-mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="relative max-h-full overflow-y-auto rounded-b-[28px] border-b border-black/10 bg-[#fffdf7] pk-safe-x pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_18px_40px_rgba(8,8,8,0.18)]"
            >
              {user && (
                <div className="mb-4 flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[#fff1bf] to-white p-3 ring-1 ring-[#feb80a]/30">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#feb80a] text-base font-black" aria-hidden="true">{user.initial}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black">{user.displayName}</span>
                    <span className="block text-xs font-semibold text-black/60">{user.roleLabel}</span>
                  </span>
                </div>
              )}

              <nav aria-label="Main navigation">
                <ul className="grid grid-cols-2 gap-2.5">
                  {primary.map((item) => {
                    const active = isNavItemActive(item, pathname);
                    return (
                      <li key={item.href} className="last:odd:col-span-2">
                        <Link
                          href={item.href}
                          onClick={close}
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-[84px] flex-col justify-between rounded-2xl border p-3.5 text-sm font-extrabold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${
                            active ? "border-black bg-black text-white" : "border-black/[0.07] bg-white text-black hover:border-black/20"
                          }`}
                        >
                          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${active ? "bg-[#feb80a] text-black" : "bg-[#fff4c7]"}`}>
                            <Icon name={item.icon} className="h-[18px] w-[18px]" />
                          </span>
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              {user ? (
                <div className="mt-3 rounded-2xl border border-black/[0.07] bg-white p-1.5">
                  {secondary.map((item) => {
                    const active = isNavItemActive(item, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={close}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-black ${active ? "bg-[#fff4c7] text-black" : "text-black/80 hover:bg-black/5"}`}
                      >
                        <Icon name={item.icon} className="h-[18px] w-[18px]" />
                        <span className="flex-1">{item.label}</span>
                        <Icon name="chevronRight" className="h-4 w-4 text-black/35" />
                      </Link>
                    );
                  })}
                  {secondary.length > 0 && <div className="mx-3 my-1 border-t border-black/5" />}
                  <SignOutRow className="min-h-12" />
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <Link href="/login" onClick={close} className="pk-btn pk-btn-secondary pk-btn-lg">Log in</Link>
                  <Link href="/register" onClick={close} className="pk-btn pk-btn-accent pk-btn-lg">Sign up</Link>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
