import { formatCampusTime } from "../../lib/student-copy";

/**
 * The settings forms' requests to /api/account/* and the words they show for each outcome. No React and no
 * "server-only", so the message rules are unit-tested; the request itself only ever runs in the browser.
 *
 * Every request says Content-Type: application/json (the account routes refuse anything else, which is part of
 * what stops another site posting to them), and the routes answer errors as JSON { error, code? }.
 */

export const NETWORK_ERROR = "We couldn’t reach PackAM. Check your connection and try again.";
/** The server's own SERVICE_UPDATING message talks about carts. */
export const UPDATING_ERROR = "PackAM is being updated, and nothing has changed. Please try again in a few minutes.";
/** A 401: this browser's session ended (for example, it was signed out from another device). */
export const SESSION_ENDED = "You’ve been signed out, so nothing was saved. Log in again, then try once more.";

export type DeletionBlockerView = { kind: string; message: string };

export type AccountFailure = {
  /** 0 when no answer arrived (offline, timed out). */
  status: number;
  code?: string;
  /** The server's own sentence, or "" when it sent none. */
  error: string;
  /** Problems by field name, e.g. { firstName: "Enter your first name." } from PATCH /api/account/profile. */
  fields: Record<string, string>;
  /** Why the account can't be deleted yet: the 409 from POST /api/account/delete, or GET's preview. */
  blockers: DeletionBlockerView[];
  retryAfterSeconds: number | null;
};

export type AccountResult<T> = { ok: true; data: T } | ({ ok: false } & AccountFailure);

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Calls one of the account routes. Never throws: a failed connection comes back as status 0. */
export async function accountRequest<T = Record<string, unknown>>(path: string, method: Method, body?: unknown): Promise<AccountResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, ...readFailure(0, null, null) };
  }
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: (isRecord(data) ? data : {}) as T };
  return { ok: false, ...readFailure(response.status, data, response.headers.get("Retry-After")) };
}

/** What an error answer says, read defensively: anything missing or of the wrong type is left out. */
export function readFailure(status: number, data: unknown, retryAfterHeader: string | null): AccountFailure {
  const body = isRecord(data) ? data : {};
  const fields = isRecord(body.fields)
    ? Object.fromEntries(Object.entries(body.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== ""))
    : {};
  const fromBody = typeof body.retryAfterSeconds === "number" && Number.isFinite(body.retryAfterSeconds) && body.retryAfterSeconds > 0 ? Math.ceil(body.retryAfterSeconds) : null;
  const fromHeader = retryAfterHeader !== null && /^\d+$/.test(retryAfterHeader.trim()) ? Number(retryAfterHeader.trim()) : null;
  return {
    status,
    code: typeof body.code === "string" ? body.code : undefined,
    error: typeof body.error === "string" ? body.error.trim() : "",
    fields,
    blockers: parseBlockers(body.blockers),
    retryAfterSeconds: fromBody ?? (fromHeader && fromHeader > 0 ? fromHeader : null),
  };
}

/** The { kind, message } entries of a blockers list; anything else in it is ignored. */
export function parseBlockers(value: unknown): DeletionBlockerView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (
    isRecord(item) && typeof item.kind === "string" && typeof item.message === "string" && item.message.trim()
      ? [{ kind: item.kind, message: item.message.trim() }]
      : []
  ));
}

/**
 * The form-level sentence for a failed request. Problems that belong to one field (a wrong password, an email
 * that's taken) are shown under that field instead, so forms check for those codes first.
 */
export function problemMessage(failure: AccountFailure, fallback: string): string {
  if (failure.status === 0) return NETWORK_ERROR;
  if (failure.status === 401) return SESSION_ENDED;
  if (failure.code === "SERVICE_UPDATING") return UPDATING_ERROR;
  if (failure.status === 429) return failure.error || `Too many attempts. Please try again ${retryWhen(failure.retryAfterSeconds)}.`;
  return failure.error || fallback;
}

/** "in a minute", "in about 12 minutes" or "in about 2 hours", from a wait in seconds. */
export function retryWhen(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "a little later";
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return "in a minute";
  if (minutes < 90) return `in about ${minutes} minutes`;
  return `in about ${Math.round(minutes / 60)} hours`;
}

/** When an emailed link stops working, in campus time, e.g. "1 Nov 2026, 9:41 am". Null for anything that isn't a date. */
export function linkExpiryLabel(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatCampusTime(date);
}

// ---- The result of opening a "confirm your new email" link ----

/** The statuses GET /api/account/email/confirm sends back to /settings?email=…. */
export const EMAIL_CHANGE_STATUSES = ["changed", "invalid", "expired", "used", "taken"] as const;
export type EmailChangeStatus = (typeof EMAIL_CHANGE_STATUSES)[number];

export function isEmailChangeStatus(value: unknown): value is EmailChangeStatus {
  return typeof value === "string" && (EMAIL_CHANGE_STATUSES as readonly string[]).includes(value);
}

/** The banner for each status. Every failure says the email hasn't changed and what to do next. */
export function emailChangeNotice(status: EmailChangeStatus, email: string): { tone: "success" | "error"; title: string; message: string } {
  switch (status) {
    case "changed":
      return { tone: "success", title: "Email changed", message: `Your account now uses ${email}, and it’s verified. Use it the next time you log in.` };
    case "expired":
      return { tone: "error", title: "That link has expired", message: "Links to confirm a new email work for 24 hours, so your email hasn’t changed. Start the change again to get a new link." };
    case "used":
      return { tone: "error", title: "That link has already been used", message: "Each link works once, and asking again replaces the earlier one. If your email below hasn’t changed, start the change again." };
    case "taken":
      return { tone: "error", title: "That email is already in use", message: "Another PackAM account started using that address before you confirmed it, so your email hasn’t changed." };
    case "invalid":
      return { tone: "error", title: "That link isn’t valid", message: "It may be incomplete or out of date, so your email hasn’t changed. Open the newest link we sent, or start the change again." };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
