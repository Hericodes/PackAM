"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server tracking page while the print job is still moving. */
export function PrintTrackingRefresher({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [router, intervalMs]);
  return <p className="mt-2 text-xs text-black/45">This page updates automatically.</p>;
}
