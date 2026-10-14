"use client";

import { useEffect, useState } from "react";
import { nextPaymentPollDelay } from "../../lib/payment-polling";

/**
 * Runs `check` on the backoff schedule while the tab is visible. `check` resolves true to keep
 * polling and must be stable (useCallback). After the schedule ends, `timedOut` becomes true.
 */
export function usePaymentPolling(check: () => Promise<boolean>) {
  const [timedOut, setTimedOut] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const tick = async () => {
      timer = undefined;
      if (stopped || document.visibilityState === "hidden") return; // resumes on visibilitychange
      const keepGoing = await check();
      if (stopped || !keepGoing) return;
      const delay = nextPaymentPollDelay(Date.now() - startedAt);
      if (delay === null) setTimedOut(true);
      else timer = setTimeout(tick, delay);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      if (timer) clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check, run]);

  return {
    timedOut,
    restart() {
      setTimedOut(false);
      setRun((value) => value + 1);
    },
  };
}
