import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidEmail } from "../account/validation";
import { EmailConfigError, parseEmailConfig, type EmailConfig } from "./config";

/**
 * Sending account email through whichever transport is configured (see config.ts). sendEmail() never throws and
 * never logs an address, subject, body, link or provider response: only the message's purpose and an error name
 * or HTTP status. A failed send changes nothing else; callers let the person ask again.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** What the email is for, e.g. "password-reset". Shown in logs and kept on test outbox messages. */
  purpose: string;
};
export type SendEmailResult = { status: "sent" | "not-configured" | "failed" };
export type OutboxMessage = EmailMessage & { sentAt: Date };
export type TestEmailMode = "memory" | "not-configured" | "failing";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;
/** Reserved names (RFC 2606/6761) that can never receive mail, e.g. seeded @packam.test staff. Real sends skip them. */
const UNDELIVERABLE = /\.(?:test|example|invalid|localhost)$/i;

let lastConfigWarning = 0;

/** True when email can be sent (or captured, in tests). Routes answer 503 EMAIL_NOT_CONFIGURED when it isn't. */
export function isEmailConfigured(): boolean {
  const config = currentConfig();
  if (!config || config.mode === "none") return false;
  return config.mode !== "memory" || testMode() !== "not-configured";
}

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const purpose = logLabel(message.purpose);
  const config = currentConfig();
  if (!config || config.mode === "none" || (config.mode === "memory" && testMode() === "not-configured")) {
    console.warn("EMAIL NOT CONFIGURED:", purpose);
    return { status: "not-configured" };
  }
  if (!isValidEmail(message.to)) {
    console.error("EMAIL NOT SENT:", purpose, "invalid recipient");
    return { status: "failed" };
  }
  try {
    if (config.mode === "memory") {
      if (testMode() === "failing") throw new TestEmailFailure();
      store.__PACKAM_TEST_OUTBOX__ = [...(store.__PACKAM_TEST_OUTBOX__ ?? []), { ...message, sentAt: new Date() }];
      return { status: "sent" };
    }
    if (config.mode === "file") {
      await writeMessageFile(config.dir, message, purpose);
      return { status: "sent" };
    }
    if (UNDELIVERABLE.test(message.to)) {
      console.error("EMAIL NOT SENT:", purpose, "reserved test domain");
      return { status: "failed" };
    }
    return await sendWithResend(config, message, purpose);
  } catch (error) {
    console.error("EMAIL SEND ERROR:", purpose, error instanceof Error ? error.name : "Unknown error");
    return { status: "failed" };
  }
}

/** The configuration, or null when it is half set up (logged at most once a minute, by variable name only). */
function currentConfig(): EmailConfig | null {
  try {
    return parseEmailConfig(process.env);
  } catch (error) {
    if (Date.now() - lastConfigWarning > 60_000) {
      lastConfigWarning = Date.now();
      // EmailConfigError messages are fixed sentences naming variables, never their values.
      console.error("EMAIL CONFIG ERROR:", error instanceof EmailConfigError ? error.message : error instanceof Error ? error.name : "Unknown error");
    }
    return null;
  }
}

async function sendWithResend(config: Extract<EmailConfig, { mode: "resend" }>, message: EmailMessage, purpose: string): Promise<SendEmailResult> {
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  // The response can echo the recipient, so it is never read or logged; only the status counts.
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) {
    console.error("EMAIL SEND ERROR:", purpose, `HTTP ${response.status}`);
    return { status: "failed" };
  }
  return { status: "sent" };
}

/** Local testing only: one JSON file per message, so links can be opened from the folder. */
async function writeMessageFile(dir: string, message: EmailMessage, purpose: string) {
  const folder = path.resolve(dir);
  await mkdir(folder, { recursive: true });
  const createdAt = new Date().toISOString();
  const file = path.join(folder, `${createdAt.replace(/[:.]/g, "-")}-${purpose}-${randomUUID().slice(0, 8)}.json`);
  await writeFile(file, JSON.stringify({ ...message, createdAt }, null, 2), { encoding: "utf8", flag: "wx" });
}

/** The purpose as a safe log label: callers pass fixed words, but nothing else ever reaches the log. */
function logLabel(purpose: string) {
  return /^[a-z0-9_-]{1,40}$/i.test(purpose) ? purpose : "email";
}

// ---- Database tests (PACKAM_DB_TEST=1 only) ----
// Kept on globalThis, like the test auth session, so the test file and the route share one outbox.

const store = globalThis as typeof globalThis & { __PACKAM_TEST_OUTBOX__?: OutboxMessage[]; __PACKAM_TEST_EMAIL_MODE__?: TestEmailMode };

class TestEmailFailure extends Error {
  constructor() {
    super("Simulated email failure.");
    this.name = "TestEmailFailure";
  }
}

function testMode(): TestEmailMode {
  return store.__PACKAM_TEST_EMAIL_MODE__ ?? "memory";
}

function requireTestRun() {
  if (process.env.PACKAM_DB_TEST !== "1" || process.env.NODE_ENV === "production") {
    throw new Error("The test outbox is only available in an enabled database test run.");
  }
}

/** Every message captured so far in this test process, oldest first. */
export function testOutbox(): readonly OutboxMessage[] {
  requireTestRun();
  return [...(store.__PACKAM_TEST_OUTBOX__ ?? [])];
}

/** Empties the outbox. The test email mode is left as it is. */
export function clearTestOutbox() {
  requireTestRun();
  store.__PACKAM_TEST_OUTBOX__ = [];
}

/**
 * "memory" (the default) captures messages; "not-configured" behaves as if no transport were set up
 * (isEmailConfigured() is false); "failing" behaves as if every send failed. Set it back to "memory" afterwards.
 */
export function setTestEmailMode(mode: TestEmailMode) {
  requireTestRun();
  store.__PACKAM_TEST_EMAIL_MODE__ = mode;
}
