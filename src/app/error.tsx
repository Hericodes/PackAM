"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Server errors arrive with a generic message and a digest that matches the server log.
    console.error("PAGE ERROR:", error.digest ?? error.name);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div role="alert" className="max-w-md text-center">
        <h1 className="text-2xl font-black sm:text-3xl">Something went wrong on our side</h1>
        <p className="mt-3 text-sm leading-6 text-black/70">E no be your fault. Your orders and payments are safe — try again in a moment.</p>
        {error.digest && <p className="mt-2 text-xs text-black/60">Reference: {error.digest}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => retry()} className="inline-flex min-h-12 items-center rounded-full bg-black px-6 text-sm font-black text-white transition hover:bg-black/85">Try again</button>
          <Link href="/" className="inline-flex min-h-12 items-center rounded-full border border-black/15 px-6 text-sm font-black transition hover:bg-black/5">Go home</Link>
        </div>
      </div>
    </main>
  );
}
