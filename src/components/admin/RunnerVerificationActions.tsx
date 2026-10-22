"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { userId: string; name: string; setupNeeded: boolean; canVerify: boolean; canUnverify: boolean };

/** Set up/verify or un-verify one runner. The server enforces the same rules and audits the change. */
export function RunnerVerificationActions({ userId, name, setupNeeded, canVerify, canUnverify }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function send(action: "verify" | "unverify") {
    if (busy) return;
    const prompt = action === "verify"
      ? `${setupNeeded ? "Set up and verify" : "Verify"} ${name} as a runner? They'll be able to go available and accept missions.`
      : `Remove verification from ${name}? They'll be taken offline and stop receiving missions.`;
    if (!window.confirm(prompt)) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/runners/${encodeURIComponent(userId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The runner couldn’t be updated.");
      setMessage({ tone: "ok", text: data.kind === "UNCHANGED" ? "Already up to date." : action === "verify" ? (data.profileCreated ? "Profile set up and verified." : "Verified.") : "Verification removed." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The runner couldn’t be updated." });
    } finally {
      setBusy(false);
    }
  }

  if (!canVerify && !canUnverify) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {canVerify && <button type="button" disabled={busy} onClick={() => void send("verify")} className="min-h-10 rounded-full bg-black px-4 text-xs font-black text-white disabled:opacity-50">{busy ? "Saving…" : setupNeeded ? "Set up & verify runner" : "Verify runner"}</button>}
      {canUnverify && <button type="button" disabled={busy} onClick={() => void send("unverify")} className="min-h-10 rounded-full border border-black/15 px-4 text-xs font-black disabled:opacity-50">{busy ? "Saving…" : "Remove verification"}</button>}
      {message && <p role={message.tone === "error" ? "alert" : "status"} className={`text-xs ${message.tone === "error" ? "text-[#c92d24]" : "text-[#16803c]"}`}>{message.text}</p>}
    </div>
  );
}
