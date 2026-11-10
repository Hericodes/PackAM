"use client";

import Link from "next/link";
import { useState } from "react";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done"; all: boolean } | { kind: "error"; text: string };

/**
 * The unsubscribe page's buttons. Nothing changes until the student taps (link scanners in mail apps open links on
 * their own, and must not unsubscribe anyone). The token in the link is all that's needed; no sign-in.
 */
export function UnsubscribeActions({ token, noun }: { token: string; noun: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function stop(all: boolean) {
    setState({ kind: "busy" });
    try {
      const response = await fetch("/api/email/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, all }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t update your emails right now. Try again.");
      setState({ kind: "done", all });
    } catch (cause) {
      setState({ kind: "error", text: cause instanceof Error ? cause.message : "We couldn’t update your emails right now. Try again." });
    }
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="mt-6 rounded-2xl border border-[#16803c]/25 bg-[#e9f8ee] p-4 text-sm leading-6">
        <p className="font-black">Done. {state.all ? "You won’t get any more PackAM emails." : `You won’t get any more ${noun}.`}</p>
        <p className="mt-1 text-black/70">Changed your mind? You can turn emails back on any time in <Link href="/settings#emails" className="font-bold underline">Settings</Link>.</p>
      </div>
    );
  }
  const busy = state.kind === "busy";
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-2.5">
        <button type="button" onClick={() => void stop(false)} disabled={busy} className="pk-btn pk-btn-primary pk-btn-lg disabled:opacity-60">{busy ? "Saving…" : `Stop ${noun}`}</button>
        <button type="button" onClick={() => void stop(true)} disabled={busy} className="pk-btn pk-btn-secondary disabled:opacity-60">Stop all PackAM emails</button>
      </div>
      {state.kind === "error" && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{state.text}</p>}
    </div>
  );
}
