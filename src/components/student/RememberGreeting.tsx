"use client";

import { useEffect } from "react";
import { GREETING_COOKIE } from "../../lib/home-greetings";

/** Stores which homepage greeting was shown, so the next visit picks a different one. Renders nothing. */
export function RememberGreeting({ index }: { index: number }) {
  useEffect(() => {
    document.cookie = `${GREETING_COOKIE}=${index}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  }, [index]);
  return null;
}
