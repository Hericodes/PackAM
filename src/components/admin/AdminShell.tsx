"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { PackAMLogo } from "../brand/PackAMLogo";
import { Icon } from "../ui/Icon";
import { ADMIN_NAV, isAdminNavActive } from "./admin-nav";

const COLLAPSED_KEY = "packam:admin-sidebar-collapsed";

function useUnreadCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    void fetch("/api/notifications").then((r) => (r.ok ? r.json() : null)).then((data) => { if (live && data) setCount(data.unreadCount ?? 0); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return count;
}

/** The link list, shared by the sidebar and the drawer. In icon-only mode labels become the accessible name and tooltip. */
function NavLinks({ pathname, iconOnly = false, onNavigate }: { pathname: string; iconOnly?: boolean; onNavigate?: () => void }) {
  return (
    <>
      {ADMIN_NAV.map((group, index) => (
        <div key={group.label ?? index} className={index ? "mt-5" : ""}>
          {group.label && (iconOnly
            ? <div aria-hidden="true" className="mx-auto mb-2 h-px w-6 bg-black/10" />
            : <p className="mb-1 px-3 text-[0.6875rem] font-black uppercase tracking-wider text-black/40">{group.label}</p>)}
          <ul className="space-y-0.5" aria-label={group.label ?? "Main"}>
            {group.items.map((item) => {
              const active = isAdminNavActive(item.href, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={iconOnly ? item.label : undefined}
                    title={iconOnly ? item.label : undefined}
                    className={`relative flex min-h-11 items-center gap-3 rounded-xl text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-black ${iconOnly ? "justify-center px-0" : "px-3"} ${active ? "bg-[#fff4c7] font-bold text-black" : "text-black/70 hover:bg-black/[0.04] hover:text-black"}`}
                  >
                    {/* A thin brand bar marks the current page alongside the tint. */}
                    {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-full bg-[#feb80a]" />}
                    <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                    {!iconOnly && <span className="min-w-0 truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

function AccountControls({ name, unread, pathname, iconOnly = false, onNavigate }: { name: string; unread: number; pathname: string; iconOnly?: boolean; onNavigate?: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const updatesActive = pathname === "/notifications";
  const settingsActive = pathname === "/settings";
  const row = `relative flex min-h-11 w-full items-center gap-3 rounded-xl text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-black ${iconOnly ? "justify-center px-0" : "px-3"}`;
  return (
    <div className="space-y-0.5">
      <Link href="/notifications" onClick={onNavigate} aria-current={updatesActive ? "page" : undefined} aria-label={`Updates${unread ? `, ${unread} unread` : ""}`} title={iconOnly ? "Updates" : undefined} className={`${row} ${updatesActive ? "bg-[#fff4c7] text-black" : "text-black/70 hover:bg-black/[0.04] hover:text-black"}`}>
        <span className="relative">
          <Icon name="bell" className="h-[18px] w-[18px]" />
          {unread > 0 && <span aria-hidden="true" className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#feb80a] px-1 text-[10px] font-black leading-none text-black">{unread > 99 ? "99+" : unread}</span>}
        </span>
        {!iconOnly && <span className="flex-1">Updates</span>}
      </Link>
      {/* Your own name, email, password and devices (the same Settings page every role has). */}
      <Link href="/settings" onClick={onNavigate} aria-current={settingsActive ? "page" : undefined} aria-label={iconOnly ? "Settings" : undefined} title={iconOnly ? "Settings" : undefined} className={`${row} ${settingsActive ? "bg-[#fff4c7] text-black" : "text-black/70 hover:bg-black/[0.04] hover:text-black"}`}>
        <Icon name="settings" className="h-[18px] w-[18px]" />
        {!iconOnly && <span className="flex-1">Settings</span>}
      </Link>
      {!iconOnly && (
        <div className="flex items-center gap-3 px-3 py-2">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#feb80a] text-xs font-black">{name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-bold">{name}</span><span className="block text-xs text-black/50">Admin</span></span>
        </div>
      )}
      <button type="button" disabled={signingOut} onClick={() => { setSigningOut(true); void signOut({ redirectTo: "/login" }); }} aria-label={iconOnly ? "Sign out" : undefined} title={iconOnly ? "Sign out" : undefined} className={`${row} text-black/70 hover:bg-black/[0.04] hover:text-black disabled:opacity-60`}>
        <Icon name="logout" className="h-[18px] w-[18px]" />
        {!iconOnly && <span>{signingOut ? "Signing out…" : "Sign out"}</span>}
      </button>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/admin" aria-label="PackAM operations home" className="flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
      <PackAMLogo width={compact ? 40 : 52} priority />
      {!compact && <span className="text-[0.625rem] font-black uppercase tracking-[0.18em] text-black/45">Operations</span>}
    </Link>
  );
}

/**
 * Admin layout: a sticky sidebar on desktop (collapsible to icons, remembered in this browser) and a top bar
 * with a slide-out drawer on phones and tablets. The page content never sits under either.
 */
export function AdminShell({ name, children }: { name: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const unread = useUnreadCount();
  const [collapsed, setCollapsed] = useState(false);
  // The drawer remembers the page it was opened on, so navigating closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const drawerOpen = openedOn === pathname;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1"); } catch { /* storage blocked: stay expanded */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      try { window.localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1"); } catch { /* not remembered */ }
      return !current;
    });
  }

  // Drawer: lock the page behind it, focus inside, Escape closes, Tab stays inside, focus returns afterwards.
  useEffect(() => {
    if (!drawerOpen) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpenedOn(null); return; }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("a, button:not([disabled])")];
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); trigger?.focus(); };
  }, [drawerOpen]);

  const closeDrawer = () => setOpenedOn(null);

  return (
    <div className="pk-theme-ops lg:flex">
      {/* Desktop sidebar */}
      <aside aria-label="Admin navigation" className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-black/[0.06] bg-white/70 backdrop-blur-sm transition-[width] duration-200 lg:flex ${collapsed ? "w-[4.5rem]" : "w-64"}`}>
        <div className={`flex items-center gap-2 pb-4 pt-5 ${collapsed ? "flex-col px-2" : "justify-between px-4"}`}>
          <Brand compact={collapsed} />
          <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-black/50 transition hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-black">
            <Icon name="panel" className="h-[18px] w-[18px]" />
          </button>
        </div>
        <nav aria-label="Admin" className={`min-h-0 flex-1 overflow-y-auto pb-4 ${collapsed ? "px-2" : "px-3"}`}>
          <NavLinks pathname={pathname} iconOnly={collapsed} />
        </nav>
        <div className={`border-t border-black/[0.06] py-3 ${collapsed ? "px-2" : "px-3"}`}>
          <AccountControls name={name} unread={unread} pathname={pathname} iconOnly={collapsed} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Phone and tablet top bar */}
        <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-[#fffdf7]/95 lg:hidden">
          <div className="packam-container flex h-14 items-center gap-2">
            <button ref={triggerRef} type="button" onClick={() => setOpenedOn(drawerOpen ? null : pathname)} aria-label="Open admin menu" aria-expanded={drawerOpen} aria-controls="admin-drawer" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black">
              <Icon name="menu" />
            </button>
            <Brand compact />
            <span className="text-[0.625rem] font-black uppercase tracking-[0.18em] text-black/45">Operations</span>
            <Link href="/notifications" aria-label={`Updates${unread ? `, ${unread} unread` : ""}`} className="relative ml-auto flex h-11 w-11 items-center justify-center rounded-xl text-black/75 transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black">
              <Icon name="bell" />
              {unread > 0 && <span aria-hidden="true" className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#feb80a] px-1 text-[11px] font-black leading-none text-black">{unread > 99 ? "99+" : unread}</span>}
            </Link>
          </div>
        </header>

        <div className="pk-ops-main">{children}</div>
      </div>

      {/* Phone and tablet drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" tabIndex={-1} aria-label="Close admin menu" onClick={closeDrawer} className="absolute inset-0 h-full w-full cursor-default bg-black/30" />
          <div ref={panelRef} id="admin-drawer" role="dialog" aria-modal="true" aria-label="Admin menu" className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col bg-[#fffdf7] shadow-[0_14px_40px_rgba(8,8,8,0.18)]">
            <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
              <Brand />
              <button type="button" onClick={closeDrawer} aria-label="Close admin menu" className="flex h-11 w-11 items-center justify-center rounded-xl text-black/60 transition hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-black">
                <Icon name="close" />
              </button>
            </div>
            <nav aria-label="Admin" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
              <NavLinks pathname={pathname} onNavigate={closeDrawer} />
            </nav>
            <div className="border-t border-black/[0.06] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              <AccountControls name={name} unread={unread} pathname={pathname} onNavigate={closeDrawer} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
