"use client";

import { useEffect, useRef, useState } from "react";
import { nextOrderingChange, orderingStatus, type OrderingClock, type OrderingStatus } from "../../lib/ordering-hours";

/**
 * Whether ordering is open right now, kept current in the browser: it flips by itself at opening and
 * closing time and re-checks when the phone wakes or the page comes back from the back/forward cache.
 *
 * Time is the server's (from the page) plus the time since the page loaded, so a phone whose clock is
 * wrong still agrees with the server. The server checks again when payment starts; this only decides
 * what the page shows.
 */
export function useOrderingStatus({ hours, serverNow }: OrderingClock): OrderingStatus {
  const [clock, setClock] = useState({ serverNow, now: serverNow });
  // A refresh brings a new server time: start again from it.
  let now = clock.now;
  if (clock.serverNow !== serverNow) {
    now = serverNow;
    setClock({ serverNow, now: serverNow });
  }
  const status = orderingStatus(new Date(now), hours);
  const nextChange = nextOrderingChange(status)?.getTime() ?? null;
  // How far the server's clock is from this phone's, measured once per server time.
  const offset = useRef<{ serverNow: number; ms: number } | null>(null);

  useEffect(() => {
    if (offset.current?.serverNow !== serverNow) offset.current = { serverNow, ms: serverNow - Date.now() };
    const { ms } = offset.current;
    const tick = () => setClock({ serverNow, now: Date.now() + ms });
    // One second after the change, so the new status is certain.
    const timer = nextChange === null ? undefined : window.setTimeout(tick, Math.max(0, nextChange - (Date.now() + ms)) + 1_000);
    // Phones pause timers while asleep.
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", tick);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", tick);
    };
  }, [serverNow, nextChange]);

  return status;
}
