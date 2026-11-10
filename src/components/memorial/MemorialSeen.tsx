"use client";

import { useEffect } from "react";
import { MEMORIAL_SEEN_KEY } from "../../config/memorial";

/** Notes in this browser that the memorial page was seen, so MemorialGate doesn't send the student back to it. */
export function MemorialSeen() {
  useEffect(() => {
    try {
      window.localStorage.setItem(MEMORIAL_SEEN_KEY, "1");
    } catch {
      // Private mode or blocked storage: the page may show once more on a later visit, nothing worse.
    }
  }, []);
  return null;
}
