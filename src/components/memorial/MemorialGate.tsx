"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MEMORIAL_SEEN_KEY, memorialActive, memorialHref } from "../../config/memorial";
import { resolvePostLoginDestination } from "../../lib/auth-redirect";

/**
 * While the memorial is up: a student who is already signed in (so never passes through log in) is taken to the
 * memorial page once per browser, from the first student page they open. Checked once per page load, never for
 * runners, admins or signed-out visitors, and never again once the page has been seen. Signing in is handled by
 * /api/login-destination, which sends students there every time.
 */
export function MemorialGate() {
  const router = useRouter();

  useEffect(() => {
    if (!memorialActive()) return;
    const here = `${window.location.pathname}${window.location.search}`;
    // Student pages only (home, food, printing, orders…): not log in, staff areas or the memorial page itself.
    if (resolvePostLoginDestination("STUDENT", here) !== here) return;
    try {
      if (window.localStorage.getItem(MEMORIAL_SEEN_KEY)) return;
    } catch {
      return; // No storage: it couldn't remember the visit, so don't risk sending them there on every page.
    }
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((session: { user?: { role?: unknown } } | null) => {
        if (session?.user?.role === "STUDENT") router.replace(memorialHref(here));
      })
      .catch(() => undefined);
    return () => controller.abort();
    // Once per page load: the first page decides; moving around afterwards doesn't re-check.
  }, [router]);

  return null;
}
