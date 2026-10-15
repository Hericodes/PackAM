"use client";

import { useCallback, useEffect, useState } from "react";
import { parseSavedProductIds, SAVED_PRODUCTS_EVENT, SAVED_PRODUCTS_KEY, toggleSavedProductId } from "../../lib/saved-products";

function read(): string[] {
  try {
    return parseSavedProductIds(window.localStorage.getItem(SAVED_PRODUCTS_KEY));
  } catch {
    return []; // private mode or blocked storage: saving simply isn't available
  }
}

/** Device-local saved products, kept in sync across components and tabs. */
export function useSavedProducts() {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setIds(read());
    const first = window.setTimeout(() => { sync(); setReady(true); }, 0);
    window.addEventListener(SAVED_PRODUCTS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener(SAVED_PRODUCTS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    const next = toggleSavedProductId(read(), id);
    try {
      window.localStorage.setItem(SAVED_PRODUCTS_KEY, JSON.stringify(next.ids));
    } catch {
      return null;
    }
    window.dispatchEvent(new Event(SAVED_PRODUCTS_EVENT));
    return next.saved;
  }, []);

  return { ids, ready, toggle, isSaved: (id: string) => ids.includes(id) };
}
