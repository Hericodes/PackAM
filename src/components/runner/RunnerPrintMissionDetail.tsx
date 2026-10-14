"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type PrintMission = {
  id: string;
  reference: string;
  assignmentStatus: string;
  status: string;
  paperSize: string;
  colorMode: string | null;
  sides: string | null;
  copies: number;
  pageSelection: string;
  selectedPageCount: number | null;
  deliveryLocationLabel: string;
  documentName?: string | null;
  documentPageCount?: number | null;
  documentAvailable?: boolean;
  instructions?: string | null;
  deliveryAddress?: string | null;
  deliveryInstructions?: string | null;
  student?: { firstName: string | null; phone: string | null } | null;
};

const nextStep: Record<string, { action: string; label: string; busy: string } | undefined> = {
  RUNNER_ASSIGNED: { action: "document-received", label: "Confirm document received", busy: "Confirming…" },
  DOCUMENT_RECEIVED: { action: "start-printing", label: "Start printing", busy: "Starting…" },
  PRINTING: { action: "printed", label: "Mark printing complete", busy: "Saving…" },
  PRINTED: { action: "start-delivery", label: "Start delivery", busy: "Starting…" },
  OUT_FOR_DELIVERY: { action: "delivered", label: "Mark delivered", busy: "Saving…" },
};

const statusCopy: Record<string, string> = {
  FINDING_RUNNER: "Waiting for a runner",
  RUNNER_ASSIGNED: "Download the document and confirm you have it",
  DOCUMENT_RECEIVED: "Document received — ready to print",
  PRINTING: "Printing in progress",
  PRINTED: "Printed — ready for delivery",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered 🎉",
  DOCUMENT_UNREADABLE: "Reported unreadable — PackAM operations is reviewing",
  PRINT_FAILED: "Reported print failure — PackAM operations is reviewing",
  REFUND_PROCESSING: "Cancelled — moved to refund processing",
};

export function RunnerPrintMissionDetail({ printJobId }: { printJobId: string }) {
  const [mission, setMission] = useState<PrintMission | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issueNote, setIssueNote] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/runner/print-missions/${encodeURIComponent(printJobId)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load this print mission.");
    setMission(data.mission);
  }, [printJobId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((e) => setLoadError(e instanceof Error ? e.message : "Unable to load this print mission.")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const confirmations: Record<string, string> = {
    delivered: "Mark this print job as delivered? Only do this once the student has it.",
    "document-unreadable": "Report the document as unreadable? PackAM operations will take over from here.",
    "print-failed": "Report that printing failed? PackAM operations will take over from here.",
  };

  async function act(action: string, successNotice = "") {
    if (busy) return;
    if (confirmations[action] && !window.confirm(confirmations[action])) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/runner/print-missions/${encodeURIComponent(printJobId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(issueNote.trim() ? { note: issueNote.trim() } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update this print mission.");
      if (successNotice) setNotice(successNotice);
      if (action !== "accept" && action !== "start-delivery") setIssueNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update this print mission.");
      await load().catch(() => undefined);
    } finally { setBusy(false); }
  }

  if (!mission) {
    return <div className="mt-6 rounded-2xl bg-white p-5 text-sm" role={loadError ? "alert" : "status"}>{loadError || "Loading print mission…"}{loadError && <Link href="/runner" className="mt-3 block font-bold underline">← Missions</Link>}</div>;
  }

  const step = mission.assignmentStatus === "ACCEPTED" ? nextStep[mission.status] : undefined;
  const pages = mission.selectedPageCount ?? 0;
  const canReportUnreadable = mission.assignmentStatus === "ACCEPTED" && ["RUNNER_ASSIGNED", "DOCUMENT_RECEIVED", "PRINTING"].includes(mission.status);
  const canReportPrintFailure = mission.assignmentStatus === "ACCEPTED" && ["DOCUMENT_RECEIVED", "PRINTING"].includes(mission.status);
  const canReportDelivery = mission.assignmentStatus === "ACCEPTED" && mission.status === "OUT_FOR_DELIVERY";

  return <>
    <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full bg-[#fff3bf] px-2.5 py-1 text-xs font-black">🖨️ Print mission</span>
        <span className="text-xs font-bold text-black/45">{mission.reference}</span>
      </div>
      <h1 className="mt-3 text-2xl font-black">{statusCopy[mission.status] ?? mission.status.replaceAll("_", " ")}</h1>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-2xl bg-[#fffdf7] p-3"><dt className="text-xs text-black/45">Pages</dt><dd className="font-black">{pages} {mission.pageSelection === "ALL" ? "(all)" : `(${mission.pageSelection})`}</dd></div>
        <div className="rounded-2xl bg-[#fffdf7] p-3"><dt className="text-xs text-black/45">Copies</dt><dd className="font-black">{mission.copies}</dd></div>
        <div className="rounded-2xl bg-[#fffdf7] p-3"><dt className="text-xs text-black/45">Paper</dt><dd className="font-black">{mission.paperSize}</dd></div>
        <div className="rounded-2xl bg-[#fffdf7] p-3"><dt className="text-xs text-black/45">Colour</dt><dd className="font-black">{mission.colorMode === "COLOR" ? "Colour" : "Black & white"}</dd></div>
        <div className="rounded-2xl bg-[#fffdf7] p-3"><dt className="text-xs text-black/45">Sides</dt><dd className="font-black">{mission.sides === "DOUBLE" ? "Double-sided" : "Single-sided"}</dd></div>
        <div className="rounded-2xl bg-[#fffdf7] p-3"><dt className="text-xs text-black/45">Deliver to</dt><dd className="font-black">{mission.deliveryLocationLabel}</dd></div>
      </dl>

      {mission.assignmentStatus === "OFFERED" ? <>
        <p className="mt-5 text-sm text-black/60">Accept to see the document and delivery details. The first runner to accept gets the mission.</p>
        <button disabled={busy} onClick={() => void act("accept", "Mission accepted 🫡")} className="mt-4 min-h-12 w-full rounded-full bg-black px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{busy ? "Accepting…" : "Accept print mission"}</button>
      </> : <>
        <section className="mt-6 border-t border-black/5 pt-5">
          <h2 className="font-black">Document</h2>
          {mission.documentName && <p className="mt-2 break-words text-sm">{mission.documentName}{mission.documentPageCount ? ` · ${mission.documentPageCount}-page PDF` : ""}</p>}
          {mission.instructions && <p className="mt-2 text-sm text-black/60"><strong>Print notes:</strong> {mission.instructions}</p>}
          {mission.documentAvailable
            ? <a href={`/api/runner/print-missions/${encodeURIComponent(mission.id)}/document`} rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center rounded-full border border-black/15 px-5 text-sm font-bold">Download PDF</a>
            : <p className="mt-2 text-xs text-black/45">The document is only available while you are receiving or printing it.</p>}
        </section>

        <section className="mt-6 border-t border-black/5 pt-5">
          <h2 className="font-black">Delivery</h2>
          <p className="mt-2 text-sm"><strong>{mission.deliveryLocationLabel}</strong>{mission.deliveryAddress ? ` · ${mission.deliveryAddress}` : ""}</p>
          {mission.deliveryInstructions && <p className="mt-1 text-sm text-black/60"><strong>Instructions:</strong> {mission.deliveryInstructions}</p>}
          {mission.student?.phone && <p className="mt-1 text-sm"><strong>Contact:</strong> <a className="underline" href={`tel:${mission.student.phone}`}>{mission.student.firstName || "Student"} · {mission.student.phone}</a></p>}
        </section>

        {step && <button disabled={busy} onClick={() => void act(step.action)} className="mt-6 min-h-12 w-full rounded-full bg-black px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{busy ? step.busy : step.label}</button>}

        {(canReportUnreadable || canReportPrintFailure || canReportDelivery) && <section className="mt-6 border-t border-black/5 pt-5">
          <h2 className="font-black">Something wrong?</h2>
          <label className="mt-3 block text-xs font-bold text-black/55" htmlFor="print-issue-note">Short note for PackAM (optional)</label>
          <input id="print-issue-note" value={issueNote} onChange={(event) => setIssueNote(event.target.value)} maxLength={500} placeholder="What happened?" className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm" />
          <div className="mt-3 flex flex-wrap gap-2">
            {canReportUnreadable && <button disabled={busy} onClick={() => void act("document-unreadable", "Reported to PackAM operations.")} className="min-h-11 rounded-full border border-black/15 px-4 text-xs font-bold disabled:opacity-50">Document unreadable</button>}
            {canReportPrintFailure && <button disabled={busy} onClick={() => void act("print-failed", "Reported to PackAM operations.")} className="min-h-11 rounded-full border border-black/15 px-4 text-xs font-bold disabled:opacity-50">Printing failed</button>}
            {canReportDelivery && <button disabled={busy} onClick={() => void act("delivery-issue", "Issue sent to PackAM operations.")} className="min-h-11 rounded-full border border-black/15 px-4 text-xs font-bold disabled:opacity-50">Can’t complete delivery</button>}
          </div>
        </section>}
      </>}
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm text-green-800">{notice}</p>}
    <Link href="/runner" className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-black/60">← Missions</Link>
  </>;
}
