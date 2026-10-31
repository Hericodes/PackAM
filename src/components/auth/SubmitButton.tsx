"use client";

import { useSyncExternalStore, type ComponentProps, type ReactNode } from "react";

const noSubscription = () => () => {};

/**
 * False on the server and while the page hydrates, true from then on (and straight away on client-side
 * navigations). Nothing changes after that, so there's nothing to subscribe to.
 */
export function useHydrated() {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

type SubmitButtonProps = Omit<ComponentProps<"button">, "type" | "children"> & {
  children: ReactNode;
  /** While true: spinner (unless reduced motion is on) and loadingLabel, aria-busy, and no second submit. */
  loading?: boolean;
  loadingLabel?: ReactNode;
};

/**
 * The full-width primary button for the auth and account forms. It stays disabled until the page has
 * hydrated: the forms have no method or action, so a click before JavaScript runs would submit them as a GET
 * to the same URL instead of signing in.
 */
export function SubmitButton({ children, loading = false, loadingLabel = "Please wait…", disabled, className = "", ...button }: SubmitButtonProps) {
  const hydrated = useHydrated();

  return (
    <button
      {...button}
      type="submit"
      disabled={!hydrated || loading || disabled}
      aria-busy={loading || undefined}
      className={`pk-btn pk-btn-primary pk-btn-lg w-full text-base transition-[background-color,opacity] duration-150 aria-busy:cursor-progress aria-busy:opacity-100 ${className}`}
    >
      {loading && <span aria-hidden="true" className="hidden h-4 w-4 shrink-0 rounded-full border-2 border-white/35 border-t-white motion-safe:block motion-safe:animate-spin" />}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
}
