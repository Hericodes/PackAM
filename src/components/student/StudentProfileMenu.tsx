"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

export function StudentProfileMenu({
  displayName,
  initial,
}: {
  displayName: string;
  initial: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState("");
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
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Open profile menu for ${displayName}`}
        aria-expanded={isOpen}
        aria-controls="student-profile-menu"
        onClick={() => {
          setError("");
          setIsOpen((open) => !open);
        }}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 bg-white text-sm font-bold text-black transition hover:border-black/20 hover:bg-black/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        {initial}
      </button>

      {isOpen && (
        <div
          id="student-profile-menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-black/10 bg-[#fffdf7] p-2 shadow-xl"
        >
          <nav aria-label="Profile navigation" className="space-y-1">
            <Link
              href="/orders"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black"
            >
              <span aria-hidden="true">📦</span>
              <span>My Orders</span>
            </Link>
            <Link
              href="/product-requests"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black"
            >
              <span aria-hidden="true">🙏</span>
              <span>My Requests</span>
            </Link>
            <Link
              href="/support"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black"
            >
              <span aria-hidden="true">❓</span>
              <span>Help &amp; Support</span>
            </Link>
          </nav>

          <div className="my-2 border-t border-black/10" />

          <button
            type="button"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black disabled:cursor-wait disabled:opacity-60"
          >
            <span aria-hidden="true">🚪</span>
            <span>{isSigningOut ? "Logging out..." : "Log out"}</span>
          </button>
          {error && (
            <p role="alert" className="px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
