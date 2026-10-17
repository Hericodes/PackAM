"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { isNavItemActive, type NavItem } from "./nav-items";

export function SignOutRow({ className = "" }: { className?: string }) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState("");

  async function handleSignOut() {
    setError("");
    setIsSigningOut(true);
    try {
      await signOut({ redirectTo: "/login" });
    } catch {
      setError("Could not log you out. Please try again.");
      setIsSigningOut(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={isSigningOut}
        onClick={() => void handleSignOut()}
        className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-black/75 transition hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-black disabled:cursor-wait disabled:opacity-60 ${className}`}
      >
        <Icon name="logout" className="h-[18px] w-[18px]" />
        <span>{isSigningOut ? "Logging out..." : "Log out"}</span>
      </button>
      {error && (
        <p role="alert" className="px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </>
  );
}

export function StudentProfileMenu({
  displayName,
  initial,
  roleLabel,
  items,
}: {
  displayName: string;
  initial: string;
  roleLabel: string;
  items: NavItem[];
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !containerRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative hidden md:block">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Open profile menu for ${displayName}`}
        aria-expanded={isOpen}
        aria-controls="student-profile-menu"
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-11 items-center gap-1.5 rounded-full border border-black/10 bg-white pl-1 pr-2.5 text-black shadow-[0_1px_2px_rgba(8,8,8,0.04)] transition hover:border-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#feb80a] text-sm font-black" aria-hidden="true">{initial}</span>
        <Icon name="chevronDown" className={`h-4 w-4 text-black/55 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div
          id="student-profile-menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_14px_40px_rgba(8,8,8,0.14)]"
        >
          <div className="border-b border-black/5 bg-gradient-to-br from-[#fff4c7] to-white px-4 py-3">
            <p className="truncate text-sm font-black">{displayName}</p>
            <p className="text-xs font-semibold text-black/60">{roleLabel}</p>
          </div>
          <div className="p-2">
            {items.length > 0 && (
              <nav aria-label="Profile navigation" className="space-y-0.5">
                {items.map((item) => {
                  const active = isNavItemActive(item, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setIsOpen(false)}
                      className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-black ${active ? "bg-[#fff4c7] text-black" : "text-black/75 hover:bg-black/5 hover:text-black"}`}
                    >
                      <Icon name={item.icon} className="h-[18px] w-[18px]" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            )}
            {items.length > 0 && <div className="my-2 border-t border-black/5" />}
            <SignOutRow />
          </div>
        </div>
      )}
    </div>
  );
}
