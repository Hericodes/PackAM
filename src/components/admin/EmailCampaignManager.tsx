"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "../ui/StatusBadge";
import { BROADCAST_LIMITS, bodyParagraphs } from "../../lib/email/campaign-rules";

type Counts = { sent: number; failed: number; waiting: number; skipped: number };
type Switch = { kind: "MORNING" | "REMINDER" | "ORDER_UPDATE"; title: string; when: string; enabled: boolean; today: Counts; audience: number | null };
type Broadcast = { id: string; subject: string; status: string; recipientCount: number; createdLabel: string; finishedLabel: string | null; createdByName: string; counts: Counts };
type Feedback = { tone: "ok" | "error"; text: string } | null;

const field = "w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-base outline-none transition placeholder:text-black/40 focus:border-black focus:shadow-[0_0_0_3px_rgba(254,184,10,0.45)] disabled:opacity-60";

async function call(url: string, method: "POST" | "PATCH", body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof data.error === "string" ? data.error : "That didn’t work. Nothing was changed — try again."), { fields: data.fields });
  return data;
}

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  return (
    <>
      <div role="status">{feedback?.tone === "ok" && <p className="mt-3 rounded-xl bg-[#e9f8ee] px-3 py-2 text-sm font-semibold text-[#16803c]">{feedback.text}</p>}</div>
      <div role="alert">{feedback?.tone === "error" && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{feedback.text}</p>}</div>
    </>
  );
}

/**
 * Admin → Emails: switches for the scheduled emails and order updates (with today's numbers and a test send), the
 * announcement composer, and announcement history. `editable` false (before the migration, or with email not set up)
 * disables everything that would send or save.
 */
export function EmailCampaignManager({ editable, switches, announcementAudience, broadcasts }: { editable: boolean; switches: Switch[]; announcementAudience: number; broadcasts: Broadcast[] }) {
  return (
    <>
      <section aria-labelledby="email-automatic" className="mt-8">
        <h2 id="email-automatic" className="text-xl font-black">Automatic emails</h2>
        <p className="mt-1 text-sm text-black/60">Sent by the scheduler every 5 minutes, in batches. Only students with a confirmed email who haven’t turned that email off get it.</p>
        <ul className="mt-3 grid gap-3">{switches.map((item) => <SwitchCard key={item.kind} item={item} editable={editable} />)}</ul>
      </section>
      <AnnouncementComposer editable={editable} audience={announcementAudience} />
      <section aria-labelledby="email-history" className="mt-10">
        <h2 id="email-history" className="text-xl font-black">Announcements</h2>
        {broadcasts.length
          ? <ul className="mt-3 grid gap-3">{broadcasts.map((broadcast) => <BroadcastCard key={broadcast.id} broadcast={broadcast} editable={editable} />)}</ul>
          : <p className="mt-3 rounded-2xl bg-white p-5 text-sm text-black/55">No announcements yet.</p>}
      </section>
    </>
  );
}

function SwitchCard({ item, editable }: { item: Switch; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"toggle" | "test" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function toggle() {
    if (!item.enabled && item.kind !== "ORDER_UPDATE" && !window.confirm(`Turn on the ${item.title.toLowerCase()}? It goes to every subscribed student from the next send time.`)) return;
    setBusy("toggle");
    setFeedback(null);
    try {
      await call("/api/admin/emails/schedule", "PATCH", { kind: item.kind, enabled: !item.enabled });
      setFeedback({ tone: "ok", text: item.enabled ? `${item.title} is off.` : `${item.title} is on.` });
      router.refresh();
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : "That didn’t work." });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setFeedback(null);
    try {
      const data = await call("/api/admin/emails/test", "POST", { kind: item.kind });
      setFeedback({ tone: "ok", text: `Test sent to ${data.sentTo}. Check your inbox (and spam).` });
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : "That didn’t work." });
    } finally {
      setBusy(null);
    }
  }

  const { today } = item;
  return (
    <li className="rounded-2xl bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2"><span className="text-lg font-black">{item.title}</span><StatusBadge label={item.enabled ? "On" : "Off"} tone={item.enabled ? "success" : "neutral"} /></p>
          <p className="mt-0.5 text-sm text-black/65">{item.when}</p>
          {item.audience !== null && <p className="mt-0.5 text-sm text-black/65">{item.audience.toLocaleString("en-NG")} {item.audience === 1 ? "student" : "students"} still to get it today</p>}
          <p className="mt-2 text-sm font-semibold">Today: {today.sent} sent{today.failed ? ` · ${today.failed} failed` : ""}{today.waiting ? ` · ${today.waiting} waiting` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void test()} disabled={!editable || busy !== null} className="pk-btn pk-btn-secondary pk-btn-sm disabled:opacity-50">{busy === "test" ? "Sending…" : "Send test to me"}</button>
          <button type="button" onClick={() => void toggle()} disabled={!editable || busy !== null} className={`pk-btn pk-btn-sm ${item.enabled ? "pk-btn-secondary" : "pk-btn-primary"} disabled:opacity-50`}>{busy === "toggle" ? "Saving…" : item.enabled ? "Turn off" : "Turn on"}</button>
        </div>
      </div>
      <FeedbackLine feedback={feedback} />
    </li>
  );
}

const EMPTY_DRAFT = { subject: "", body: "", buttonLabel: "", buttonUrl: "" };

function AnnouncementComposer({ editable, audience }: { editable: boolean; audience: number }) {
  const router = useRouter();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (key: keyof typeof EMPTY_DRAFT) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const paragraphs = bodyParagraphs(draft.body);

  async function run(kind: "test" | "send", event?: FormEvent) {
    event?.preventDefault();
    if (kind === "send" && !window.confirm(`Send “${draft.subject.trim()}” to ${audience.toLocaleString("en-NG")} students? This can’t be undone once it starts (you can stop what hasn’t gone out yet).`)) return;
    setBusy(kind);
    setFeedback(null);
    setFields({});
    try {
      if (kind === "test") {
        const data = await call("/api/admin/emails/test", "POST", { kind: "ANNOUNCEMENT", ...draft });
        setFeedback({ tone: "ok", text: `Test sent to ${data.sentTo}. Check how it looks, then send it.` });
      } else {
        const data = await call("/api/admin/emails/broadcasts", "POST", draft);
        setFeedback({ tone: "ok", text: `Sending to ${data.broadcast?.recipientCount ?? audience} students. It starts within 5 minutes; progress shows below.` });
        setDraft(EMPTY_DRAFT);
        router.refresh();
      }
    } catch (cause) {
      const failed = cause as Error & { fields?: Record<string, string> };
      if (failed.fields) setFields(failed.fields);
      setFeedback({ tone: "error", text: failed.message });
    } finally {
      setBusy(null);
    }
  }

  const disabled = !editable || busy !== null;
  const error = (key: string) => fields[key] ? <p className="mt-1 text-sm font-semibold text-red-700">{fields[key]}</p> : null;
  return (
    <form onSubmit={(event) => void run("send", event)} noValidate aria-labelledby="email-compose" className="mt-10 rounded-2xl bg-white p-4 sm:p-6">
      <h2 id="email-compose" className="text-xl font-black">Send an announcement</h2>
      <p className="mt-1 text-sm text-black/60">Goes to the {audience.toLocaleString("en-NG")} {audience === 1 ? "student" : "students"} with a confirmed email who have news and offers on. Send yourself a test first.</p>
      <div className="mt-4 grid gap-4">
        <div>
          <label htmlFor="announce-subject" className="mb-1 block text-sm font-black">Subject</label>
          <input id="announce-subject" value={draft.subject} onChange={set("subject")} maxLength={BROADCAST_LIMITS.subject} placeholder="e.g. New: Mama Put now on PackAM 🍲" className={field} disabled={disabled} aria-invalid={Boolean(fields.subject)} />
          {error("subject")}
        </div>
        <div>
          <label htmlFor="announce-body" className="mb-1 block text-sm font-black">Message</label>
          <textarea id="announce-body" value={draft.body} onChange={set("body")} maxLength={BROADCAST_LIMITS.body} rows={7} placeholder={"Write it like you’d text a friend.\n\nLeave a blank line between paragraphs."} className={`${field} min-h-40 resize-y`} disabled={disabled} aria-invalid={Boolean(fields.body)} />
          <p className="mt-1 text-xs text-black/55">{draft.body.length}/{BROADCAST_LIMITS.body} · {paragraphs.length} {paragraphs.length === 1 ? "paragraph" : "paragraphs"}. Students see “Hi [their name],” first.</p>
          {error("body")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="announce-button" className="mb-1 block text-sm font-black">Button text <span className="font-medium text-black/50">(optional)</span></label>
            <input id="announce-button" value={draft.buttonLabel} onChange={set("buttonLabel")} maxLength={BROADCAST_LIMITS.buttonLabel} placeholder="e.g. Order now" className={field} disabled={disabled} aria-invalid={Boolean(fields.buttonLabel)} />
            {error("buttonLabel")}
          </div>
          <div>
            <label htmlFor="announce-url" className="mb-1 block text-sm font-black">Button link <span className="font-medium text-black/50">(optional)</span></label>
            <input id="announce-url" value={draft.buttonUrl} onChange={set("buttonUrl")} maxLength={BROADCAST_LIMITS.buttonUrl} placeholder="https://www.packam.app/food" inputMode="url" className={field} disabled={disabled} aria-invalid={Boolean(fields.buttonUrl)} />
            {error("buttonUrl")}
          </div>
        </div>
      </div>
      <FeedbackLine feedback={feedback} />
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void run("test")} disabled={disabled || !draft.subject.trim() || !draft.body.trim()} className="pk-btn pk-btn-secondary disabled:opacity-50">{busy === "test" ? "Sending…" : "Send test to me"}</button>
        <button type="submit" disabled={disabled || !draft.subject.trim() || !draft.body.trim() || audience === 0} className="pk-btn pk-btn-primary disabled:opacity-50">{busy === "send" ? "Starting…" : `Send to ${audience.toLocaleString("en-NG")} students`}</button>
      </div>
    </form>
  );
}

const BROADCAST_STATUS: Record<string, { label: string; tone: "success" | "progress" | "neutral" }> = {
  SENDING: { label: "Sending", tone: "progress" },
  SENT: { label: "Sent", tone: "success" },
  CANCELLED: { label: "Stopped", tone: "neutral" },
};

function BroadcastCard({ broadcast, editable }: { broadcast: Broadcast; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = BROADCAST_STATUS[broadcast.status] ?? { label: broadcast.status, tone: "neutral" as const };

  async function cancel() {
    if (!window.confirm("Stop this announcement? Students who already got it keep it; nobody else will.")) return;
    setBusy(true);
    setError("");
    try {
      await call(`/api/admin/emails/broadcasts/${encodeURIComponent(broadcast.id)}`, "PATCH", { action: "cancel" });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  const { counts } = broadcast;
  return (
    <li className="rounded-2xl bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2"><span className="font-black">{broadcast.subject}</span><StatusBadge label={status.label} tone={status.tone} /></p>
          <p className="mt-1 text-sm font-semibold">{counts.sent.toLocaleString("en-NG")} sent{counts.failed ? ` · ${counts.failed} failed` : ""}{counts.waiting ? ` · ${counts.waiting} waiting` : ""} · about {broadcast.recipientCount.toLocaleString("en-NG")} students</p>
          <p className="mt-1 text-xs text-black/50">{broadcast.createdLabel} by {broadcast.createdByName}{broadcast.finishedLabel ? ` · finished ${broadcast.finishedLabel}` : ""}</p>
        </div>
        {broadcast.status === "SENDING" && <button type="button" onClick={() => void cancel()} disabled={!editable || busy} className="pk-btn pk-btn-secondary pk-btn-sm disabled:opacity-50">{busy ? "Stopping…" : "Stop"}</button>}
      </div>
      {error && <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
    </li>
  );
}
