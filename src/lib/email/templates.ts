/**
 * The emails PackAM sends about an account. Pure (no I/O, no environment) and unit-tested. Every value placed in
 * the HTML is escaped; links arrive ready-made from appUrl() and must be http(s); subjects are fixed sentences, so
 * they never carry a token or an address. Each email has a plain-text part and a simple inline-styled HTML part in
 * PackAM's colours, with no images that a mail app could block.
 *
 * The link lifetimes in the copy (24 hours, 30 minutes) match TOKEN_TTL_MS in src/lib/account/account-tokens.ts.
 */

export type EmailContent = { subject: string; text: string; html: string };

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "button"; label: string; href: string }
  | { kind: "note"; text: string };

const INK = "#080808";
/** rgba(8,8,8,0.68) on white, as a solid colour for mail apps that ignore alpha. */
const MUTED = "#575757";
/** The wordmark's "AM": brand yellow itself is too faint for text on white. */
const GOLD = "#875a00";
const YELLOW = "#feb80a";
const CREAM = "#fffdf7";
const LINE = "#ececec";
const FONT = "Roboto, Arial, Helvetica, sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function verifyEmail(name: string | null | undefined, link: string): EmailContent {
  return compose({
    subject: "Confirm your email for PackAM",
    preview: "One tap to confirm this is your email address.",
    heading: "Confirm your email",
    name,
    blocks: [
      { kind: "paragraph", text: "Please confirm this is your email address, so PackAM can reach you about your account." },
      { kind: "button", label: "Confirm my email", href: checkedLink(link) },
      { kind: "note", text: "This link works for 24 hours. If you didn’t create a PackAM account, you can ignore this email." },
    ],
  });
}

export function resetPassword(name: string | null | undefined, link: string): EmailContent {
  return compose({
    subject: "Reset your PackAM password",
    preview: "Choose a new password for your PackAM account.",
    heading: "Reset your password",
    name,
    blocks: [
      { kind: "paragraph", text: "We got a request to reset the password for your PackAM account." },
      { kind: "button", label: "Choose a new password", href: checkedLink(link) },
      { kind: "note", text: "This link works once, for 30 minutes. If you didn’t ask for it, you can ignore this email: your password won’t change." },
    ],
  });
}

/** Sent to the NEW address, which is the reader's own, so it is shown in full. */
export function confirmEmailChange(name: string | null | undefined, link: string, newEmail: string): EmailContent {
  return compose({
    subject: "Confirm your new PackAM email",
    preview: "Confirm this address to finish changing your PackAM email.",
    heading: "Confirm your new email",
    name,
    blocks: [
      { kind: "paragraph", text: `You asked to use ${oneLine(newEmail)} for your PackAM account. Confirm it’s yours to finish the change.` },
      { kind: "button", label: "Confirm new email", href: checkedLink(link) },
      { kind: "note", text: "This link works for 24 hours. Until you confirm, your account keeps using your current email. If you didn’t ask for this, you can ignore this email." },
    ],
  });
}

/** Sent to the OLD address when a change is requested. Pass the new address already masked (maskEmail). */
export function emailChangeRequestedNotice(name: string | null | undefined, newEmailMasked: string): EmailContent {
  return compose({
    subject: "Your PackAM email is about to change",
    preview: "Someone asked to change the email on your PackAM account.",
    heading: "Email change requested",
    name,
    blocks: [
      { kind: "paragraph", text: `Someone asked to change the email on your PackAM account to ${oneLine(newEmailMasked)}. Nothing changes unless that address is confirmed.` },
      { kind: "paragraph", text: "If this was you, there’s nothing to do here. If it wasn’t, sign in to PackAM, cancel the change in Settings and change your password." },
    ],
  });
}

export function passwordChangedNotice(name: string | null | undefined): EmailContent {
  return compose({
    subject: "Your PackAM password was changed",
    preview: "The password for your PackAM account was just changed.",
    heading: "Your password was changed",
    name,
    blocks: [
      { kind: "paragraph", text: "The password for your PackAM account was just changed, and your other devices were signed out." },
      { kind: "paragraph", text: "If this was you, there’s nothing else to do. If it wasn’t, choose “Forgot password?” on the PackAM login page to set a new one straight away, then contact PackAM support." },
    ],
  });
}

/** Sent to the OLD address once the change is confirmed. */
export function emailChangedNotice(name: string | null | undefined): EmailContent {
  return compose({
    subject: "Your PackAM email was changed",
    preview: "The email address on your PackAM account was changed.",
    heading: "Your email was changed",
    name,
    blocks: [
      { kind: "paragraph", text: "The email address on your PackAM account was just changed. From now on, account emails go to the new address." },
      { kind: "paragraph", text: "If you didn’t make this change, contact PackAM support straight away." },
    ],
  });
}

export function accountDeletedNotice(name: string | null | undefined): EmailContent {
  return compose({
    subject: "Your PackAM account has been deleted",
    preview: "Your PackAM account is closed.",
    heading: "Your account has been deleted",
    name,
    blocks: [
      { kind: "paragraph", text: "Your PackAM account is closed, and you’ve been signed out everywhere. We’ve removed your name, phone number, saved addresses and cart." },
      { kind: "paragraph", text: "We keep records of past orders, payments, refunds and print jobs, and of support conversations, because we need them for accounting and to sort out any disputes." },
      { kind: "paragraph", text: "Thanks for using PackAM. You’re welcome back any time." },
    ],
  });
}

/** Whitespace collapsed, so a stored value can't add lines to the text part. */
function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function greeting(name: string | null | undefined) {
  const first = Array.from(oneLine(name ?? "")).slice(0, 60).join("");
  return first ? `Hi ${first},` : "Hi there,";
}

function checkedLink(link: string) {
  let url: URL | null = null;
  try {
    url = new URL(link);
  } catch {
    // Reported below.
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) throw new Error("Email links must be absolute http(s) URLs.");
  return url.toString();
}

const PARAGRAPH = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};`;
const NOTE = `margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};`;
const FOOTER = "You’re getting this email because it’s about your PackAM account.";

function compose(input: { subject: string; preview: string; heading: string; name: string | null | undefined; blocks: Block[] }): EmailContent {
  const hello = greeting(input.name);
  const text = [
    hello,
    ...input.blocks.map((block) => (block.kind === "button" ? `${block.label}:\n${block.href}` : block.text)),
    `${FOOTER}\nPackAM`,
  ].join("\n\n") + "\n";
  const html = [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(input.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background-color:${CREAM};">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preview)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM};"><tr><td align="center" style="padding:24px 16px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border:1px solid ${LINE};border-radius:20px;">`,
    `<tr><td style="height:6px;line-height:6px;font-size:0;background-color:${YELLOW};border-radius:20px 20px 0 0;">&nbsp;</td></tr>`,
    `<tr><td style="padding:24px 24px 4px;font-family:${FONT};font-size:24px;font-weight:900;letter-spacing:-0.5px;color:${INK};">Pack<span style="color:${GOLD};">AM</span></td></tr>`,
    `<tr><td style="padding:12px 24px 8px;">`,
    `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:900;color:${INK};">${escapeHtml(input.heading)}</h1>`,
    `<p style="${PARAGRAPH}">${escapeHtml(hello)}</p>`,
    ...input.blocks.map(blockHtml),
    "</td></tr>",
    `<tr><td style="padding:16px 24px 24px;border-top:1px solid ${LINE};font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">${escapeHtml(FOOTER)}</td></tr>`,
    "</table>",
    "</td></tr></table>",
    "</body></html>",
  ].join("\n");
  return { subject: input.subject, text, html };
}

function blockHtml(block: Block) {
  if (block.kind === "paragraph") return `<p style="${PARAGRAPH}">${escapeHtml(block.text)}</p>`;
  if (block.kind === "note") return `<p style="${NOTE}">${escapeHtml(block.text)}</p>`;
  const href = escapeHtml(block.href);
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;"><tr><td style="border-radius:999px;background-color:${YELLOW};">`,
    `<a href="${href}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:800;line-height:1.2;color:${INK};text-decoration:none;border-radius:999px;">${escapeHtml(block.label)}</a>`,
    "</td></tr></table>",
    `<p style="${NOTE}word-break:break-all;">If the button doesn’t work, copy this link into your browser:<br><a href="${href}" style="color:${INK};">${href}</a></p>`,
  ].join("\n");
}
