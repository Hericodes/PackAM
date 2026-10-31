"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { isValidEmail, normaliseEmail } from "../../lib/account/validation";
import { FormAlert } from "../auth/FormAlert";
import { PasswordField } from "../auth/PasswordField";
import { SubmitButton } from "../auth/SubmitButton";
import { TextField } from "../auth/TextField";
import { Icon } from "../ui/Icon";
import { SettingsNotice, type Notice } from "./SettingsNotice";
import { SettingsSection } from "./SettingsSection";
import { VerifyEmailBanner } from "./VerifyEmailBanner";
import { accountRequest, linkExpiryLabel, problemMessage } from "./account-requests";

type Pending = { email: string; expires: string | null };
type FieldErrors = { newEmail?: string; password?: string };

type EmailSectionProps = {
  email: string;
  verified: boolean;
  /** A change waiting for its link to be opened, with when that link stops working (formatted on the server). */
  pendingEmail: string | null;
  pendingExpires: string | null;
  /** False while PackAM can't send email: nothing that needs a link is offered. */
  emailAvailable: boolean;
  /** Admins can't open support requests, so they aren't pointed there. */
  supportAvailable: boolean;
};

/** The codes POST /api/account/email answers that belong under one of its two fields. */
const NEW_EMAIL_CODES = new Set(["INVALID_EMAIL", "SAME_EMAIL", "EMAIL_TAKEN"]);

/**
 * The account's email and whether it's verified, a way to verify it, and the email change: a new address plus the
 * current password sends a link to the new address, and nothing changes until it's opened (the old address keeps
 * working, and gets a notice). A pending change can be cancelled. The page re-reads the account after some
 * actions elsewhere (a password change cancels a pending change), so what the server says wins when it changes.
 */
export function EmailSection({ email, verified: serverVerified, pendingEmail, pendingExpires, emailAvailable, supportAvailable }: EmailSectionProps) {
  const serverPending: Pending | null = pendingEmail ? { email: pendingEmail, expires: pendingExpires } : null;
  const serverKey = `${email}|${serverVerified}|${pendingEmail ?? ""}|${pendingExpires ?? ""}`;
  const [syncedKey, setSyncedKey] = useState(serverKey);
  const [verified, setVerified] = useState(serverVerified);
  const [pending, setPending] = useState<Pending | null>(serverPending);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formProblem, setFormProblem] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);

  const sending = useRef(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const newEmailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Fresh account data from the server (after router.refresh()) replaces what this section remembered.
  if (syncedKey !== serverKey) {
    setSyncedKey(serverKey);
    setVerified(serverVerified);
    setPending(serverPending);
    setNotice(null);
  }

  function showNotice(next: Notice, update?: () => void) {
    flushSync(() => {
      update?.();
      setNotice(next);
    });
    noticeRef.current?.focus();
  }

  function showFieldErrors(next: FieldErrors) {
    flushSync(() => setErrors(next));
    (next.newEmail ? newEmailRef : passwordRef).current?.focus();
  }

  function showFormProblem(next: Notice) {
    flushSync(() => setFormProblem(next));
    problemRef.current?.focus();
  }

  function openForm() {
    flushSync(() => {
      setChanging(true);
      setNotice(null);
    });
    newEmailRef.current?.focus();
  }

  function closeForm() {
    flushSync(() => {
      setChanging(false);
      setNewEmail("");
      setPassword("");
      setErrors({});
      setFormProblem(null);
    });
    changeButtonRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setFormProblem(null);
    const address = normaliseEmail(newEmail);
    const next: FieldErrors = {
      newEmail: !isValidEmail(address)
        ? "Enter a valid email address, like you@example.com."
        : address === email ? "That’s already your email address. Enter the new one." : undefined,
      password: password ? undefined : "Enter your current password.",
    };
    if (next.newEmail || next.password) {
      showFieldErrors(next);
      return;
    }

    sending.current = true;
    setErrors({});
    setLoading(true);
    try {
      const result = await accountRequest<{ pendingEmail?: unknown; pendingEmailExpiresAt?: unknown }>("/api/account/email", "POST", { newEmail: address, currentPassword: password });
      if (result.ok) {
        const sentTo = typeof result.data.pendingEmail === "string" ? result.data.pendingEmail : address;
        showNotice(
          { tone: "success", title: "Check your new inbox", message: `We’ve sent a link to ${sentTo}. Your email changes once you open it. Until then, keep using ${email} to log in.` },
          () => {
            setPending({ email: sentTo, expires: linkExpiryLabel(result.data.pendingEmailExpiresAt) });
            setChanging(false);
            setNewEmail("");
            setPassword("");
          },
        );
      } else if (result.code && NEW_EMAIL_CODES.has(result.code)) {
        showFieldErrors({ newEmail: result.error || "Enter a different email address." });
      } else if (result.code === "WRONG_PASSWORD") {
        showFieldErrors({ password: result.error || "That isn’t your current password. Check it and try again." });
      } else {
        showFormProblem({ tone: "error", message: problemMessage(result, "We couldn’t start your email change. Please try again."), signIn: result.status === 401 });
      }
    } finally {
      sending.current = false;
      setLoading(false);
    }
  }

  async function cancelPending() {
    if (sending.current) return;
    sending.current = true;
    setCancelling(true);
    setNotice(null);
    try {
      const result = await accountRequest("/api/account/email", "DELETE");
      if (result.ok) {
        showNotice({ tone: "success", message: "Email change cancelled. The link we sent won’t work any more." }, () => setPending(null));
      } else {
        showNotice({ tone: "error", message: problemMessage(result, "We couldn’t cancel your email change. Please try again."), signIn: result.status === 401 });
      }
    } finally {
      sending.current = false;
      setCancelling(false);
    }
  }

  function handleVerified() {
    showNotice({ tone: "success", message: "Your email is already verified. There’s nothing else to do." }, () => setVerified(true));
  }

  return (
    <SettingsSection id="email" icon="mail" title="Email" description="Where PackAM sends emails about your account, like password resets. You can log in with it, too.">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[14px] border border-black/7 bg-packam-grey-50 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-black/55">Current email</p>
          <p className="break-all text-[0.9375rem] font-bold leading-6">{email}</p>
        </div>
        {verified ? (
          <span className="pk-pill pk-pill-success"><Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.6} />Verified</span>
        ) : (
          <span className={`pk-pill ${emailAvailable ? "pk-pill-warning" : "pk-pill-neutral"}`}><Icon name="alert" className="h-3.5 w-3.5" strokeWidth={2.2} />Not verified</span>
        )}
      </div>

      {!verified && (emailAvailable
        ? <VerifyEmailBanner email={email} onVerified={handleVerified} className="mt-3" />
        : <p className="mt-3 text-sm leading-6 text-black/65">PackAM can’t send emails right now, so your address can’t be verified yet. You don’t need to do anything: nothing is blocked while it’s unverified.</p>)}

      {pending && (
        <div className="mt-4 rounded-[14px] border border-black/10 bg-white px-4 py-3.5">
          <p className="flex items-center gap-2 text-sm font-black">
            <Icon name="clock" className="h-4 w-4" strokeWidth={2.1} />
            Waiting for you to confirm your new email
          </p>
          <p className="mt-1 text-sm leading-6 text-black/70">
            We sent a link to <span className="break-all font-bold text-black">{pending.email}</span>. Open it{pending.expires ? ` by ${pending.expires}` : ""} to finish the change. Until then, your account keeps using {email}.
          </p>
          <button type="button" onClick={() => void cancelPending()} disabled={cancelling} aria-busy={cancelling || undefined} className="pk-btn pk-btn-secondary mt-3">
            {cancelling ? "Cancelling…" : "Cancel this change"}
          </button>
        </div>
      )}

      {notice && <SettingsNotice ref={noticeRef} notice={notice} className="mt-4" />}

      {changing ? (
        <form onSubmit={handleSubmit} noValidate aria-labelledby="email-change-heading" className="mt-5 space-y-5 border-t border-black/6 pt-5">
          <h3 id="email-change-heading" className="text-base font-black">Change your email</h3>
          {/* Tells password managers which account the password below belongs to. Unnamed, like every field here. */}
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <TextField
            ref={newEmailRef}
            id="email-new"
            label="New email address"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="you@example.com"
            required
            value={newEmail}
            onChange={(event) => {
              setNewEmail(event.target.value);
              if (errors.newEmail) setErrors((current) => ({ ...current, newEmail: undefined }));
            }}
            error={errors.newEmail}
            hint="We’ll email a link to this address. Your email changes once you open it."
          />
          <PasswordField
            ref={passwordRef}
            id="email-current-password"
            label="Current password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
            }}
            error={errors.password}
            hint="So we know it’s really you."
          />
          {formProblem && <SettingsNotice ref={problemRef} notice={formProblem} />}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SubmitButton loading={loading} loadingLabel="Sending link…" className="sm:w-auto">Send confirmation link</SubmitButton>
            <button type="button" onClick={closeForm} disabled={loading} className="pk-btn pk-btn-ghost pk-btn-lg text-base">Cancel</button>
          </div>
        </form>
      ) : emailAvailable ? (
        <button ref={changeButtonRef} type="button" onClick={openForm} className="pk-btn pk-btn-secondary mt-5">
          {pending ? "Use a different new email" : "Change email"}
        </button>
      ) : (
        <FormAlert tone="info" className="mt-5">
          Changing your email needs a confirmation link, and PackAM can’t send emails right now.{" "}
          {supportAvailable
            ? <>If yours has changed, <Link href="/support" className="font-bold text-black underline underline-offset-4">contact support</Link>.</>
            : <>Please try again later.</>}
        </FormAlert>
      )}
    </SettingsSection>
  );
}
