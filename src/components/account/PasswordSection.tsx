"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { passwordProblem } from "../../lib/account/password-policy";
import { PasswordChecklist } from "../auth/PasswordChecklist";
import { PasswordField } from "../auth/PasswordField";
import { SubmitButton } from "../auth/SubmitButton";
import { SettingsNotice, type Notice } from "./SettingsNotice";
import { SettingsSection } from "./SettingsSection";
import { accountRequest, problemMessage } from "./account-requests";
import { LOG_IN_AGAIN, signInAgain } from "./sign-in-again";

type FieldErrors = { current?: string; next?: string; confirm?: string };

type PasswordSectionProps = {
  email: string;
  /** First and last name, for the "doesn't contain your name or email" rule. */
  names: string[];
  /** When the password last changed, formatted on the server; null if it never has since sign-up. */
  lastChanged: string | null;
  /** Whether a reset link can be emailed: offers "Forgot it?" only when it can. */
  resetAvailable: boolean;
};

/**
 * Changing the password: the current one exactly as typed (never trimmed or re-checked against today's rules), a
 * new one that passes the policy, and the new one again. The server signs out every device, this one included, so
 * this browser signs straight back in with the new password. If that fails, it goes to log in.
 */
export function PasswordSection({ email, names, lastChanged, resetAvailable }: PasswordSectionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Notice | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const sending = useRef(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const personal = { email, names };

  function showFieldErrors(found: FieldErrors) {
    flushSync(() => setErrors(found));
    (found.current ? currentRef : found.next ? nextRef : confirmRef).current?.focus();
  }

  function showProblem(found: Notice) {
    flushSync(() => setProblem(found));
    problemRef.current?.focus();
  }

  function openForm() {
    flushSync(() => {
      setOpen(true);
      setNotice(null);
    });
    currentRef.current?.focus();
  }

  function reset() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setErrors({});
    setProblem(null);
  }

  function closeForm() {
    flushSync(reset);
    openButtonRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setProblem(null);
    const found: FieldErrors = {
      current: current ? undefined : "Enter your current password.",
      next: passwordProblem(next, personal) ?? (next === current ? "Choose a new password that’s different from your current one." : undefined),
      confirm: !confirm ? "Type your new password again." : confirm !== next ? "The passwords don’t match. Type the same password in both boxes." : undefined,
    };
    if (found.current || found.next || found.confirm) {
      showFieldErrors(found);
      return;
    }

    sending.current = true;
    setErrors({});
    setLoadingLabel("Changing your password…");
    let leaving = false;
    try {
      const result = await accountRequest("/api/account/password", "POST", { currentPassword: current, newPassword: next });
      if (result.ok) {
        // Every session just ended, this one too: sign back in with the new password to stay signed in here.
        setLoadingLabel("Keeping you signed in…");
        if (await signInAgain(email, next)) {
          flushSync(() => {
            reset();
            setNotice({ tone: "success", title: "Password changed", message: "You’re still signed in on this device, and we’ve signed you out everywhere else. Use your new password next time you log in." });
          });
          noticeRef.current?.focus();
          router.refresh();
        } else {
          // The password did change, but this browser is signed out too: a fresh login page, so nothing signed-in
          // is left in this tab's memory.
          leaving = true;
          window.location.replace(LOG_IN_AGAIN);
        }
      } else if (result.code === "WRONG_PASSWORD") {
        showFieldErrors({ current: result.error || "That isn’t your current password. Check it and try again." });
      } else if (result.code === "WEAK_PASSWORD") {
        showFieldErrors({ next: result.error || "Choose a different password." });
      } else {
        showProblem({
          tone: "error",
          message: problemMessage(result, "We couldn’t change your password. Please try again."),
          // ACCOUNT_CHANGED: it was changed elsewhere meanwhile, which signed this browser out.
          signIn: result.status === 401 || result.code === "ACCOUNT_CHANGED",
        });
      }
    } finally {
      if (!leaving) {
        sending.current = false;
        setLoadingLabel(null);
      }
    }
  }

  return (
    <SettingsSection id="password" icon="lock" title="Password" description="Changing your password signs you out on your other devices.">
      {notice && <SettingsNotice ref={noticeRef} notice={notice} className="mb-4" />}

      {open ? (
        <form onSubmit={handleSubmit} noValidate aria-labelledby="password-change-heading" className="space-y-5">
          <h3 id="password-change-heading" className="text-base font-black">Change your password</h3>
          {/* Tells password managers which account the new password is for. Unnamed, like every field here. */}
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <PasswordField
            ref={currentRef}
            id="password-current"
            label="Current password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value);
              if (errors.current) setErrors((existing) => ({ ...existing, current: undefined }));
            }}
            error={errors.current}
            labelAside={resetAvailable ? (
              <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-sm font-bold underline decoration-black/30 underline-offset-4 hover:decoration-black">
                Forgot it?
              </Link>
            ) : undefined}
          />
          <PasswordField
            ref={nextRef}
            id="password-new"
            label="New password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(event) => {
              setNext(event.target.value);
              if (errors.next) setErrors((existing) => ({ ...existing, next: undefined }));
            }}
            error={errors.next}
            aria-describedby="password-new-rules"
          >
            <PasswordChecklist id="password-new-rules" password={next} personal={personal} className="mt-3" />
          </PasswordField>
          <PasswordField
            ref={confirmRef}
            id="password-confirm"
            label="Confirm new password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value);
              if (errors.confirm) setErrors((existing) => ({ ...existing, confirm: undefined }));
            }}
            error={errors.confirm}
          />
          {problem && <SettingsNotice ref={problemRef} notice={problem} />}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SubmitButton loading={loadingLabel !== null} loadingLabel={loadingLabel ?? undefined} className="sm:w-auto">Save new password</SubmitButton>
            <button type="button" onClick={closeForm} disabled={loadingLabel !== null} className="pk-btn pk-btn-ghost pk-btn-lg text-base">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-black/70">
            {lastChanged ? <>Last changed on <span className="font-bold text-black">{lastChanged}</span>.</> : "Use a strong password that you don’t use anywhere else."}
          </p>
          <button ref={openButtonRef} type="button" onClick={openForm} className="pk-btn pk-btn-secondary shrink-0">Change password</button>
        </div>
      )}
    </SettingsSection>
  );
}
