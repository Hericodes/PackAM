"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { DELETE_CONFIRMATION, isDeleteConfirmation } from "../../lib/account/deletion-policy";
import { FormAlert } from "../auth/FormAlert";
import { PasswordField } from "../auth/PasswordField";
import { SubmitButton } from "../auth/SubmitButton";
import { TextField } from "../auth/TextField";
import { Icon } from "../ui/Icon";
import { SettingsNotice, type Notice } from "./SettingsNotice";
import { SettingsSection } from "./SettingsSection";
import { accountRequest, parseBlockers, problemMessage, type DeletionBlockerView } from "./account-requests";

type FieldErrors = { password?: string; confirm?: string };

const GOODBYE = "/?accountDeleted=1";

const REMOVED = [
  "Your name, phone number, email address and password",
  "Your saved delivery addresses, cart and notifications",
  "Product requests we haven’t answered yet, and print jobs you haven’t paid for (we cancel them)",
  "Files you uploaded for printing",
];

const KEPT = [
  "Past orders, payments, refunds and print jobs, with the delivery addresses and notes on them",
  "Your support conversations",
  "Records of changes to your orders and account",
];

/**
 * Students only (the page leaves it out for other roles, and the API refuses them). The account is anonymised, not
 * erased: the lists say plainly what goes and what stays for accounting and disputes. Opening the panel checks
 * for anything still in progress (GET /api/account/delete) so the student learns before typing a password; the
 * delete itself checks again and answers 409 with the same blockers. Needs the current password and "DELETE".
 * Afterwards this browser signs out and lands on the home page.
 */
export function DeleteAccountSection({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [blockers, setBlockers] = useState<DeletionBlockerView[]>([]);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Notice | null>(null);
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const sending = useRef(false);
  /** Only the newest check may update the panel (it can be closed and reopened while one is on its way). */
  const latestCheck = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const blockersRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);

  /**
   * What would block deleting right now, or null when a newer check (or closing the panel) replaced this one. If the
   * check itself fails, nothing is reported and the form shows: the delete checks again anyway.
   */
  async function checkBlockers(): Promise<DeletionBlockerView[] | null> {
    const id = ++latestCheck.current;
    setChecking(true);
    const result = await accountRequest<{ blockers?: unknown }>("/api/account/delete", "GET");
    if (id !== latestCheck.current) return null;
    setChecking(false);
    return result.ok ? parseBlockers(result.data.blockers) : [];
  }

  async function openPanel() {
    flushSync(() => setOpen(true));
    // The panel starts with what deleting means, so it's read from the top.
    headingRef.current?.focus();
    const found = await checkBlockers();
    if (found) setBlockers(found);
  }

  async function checkAgain() {
    const found = await checkBlockers();
    if (!found) return;
    flushSync(() => setBlockers(found));
    (found.length ? blockersRef : passwordRef).current?.focus();
  }

  function closePanel() {
    latestCheck.current += 1;
    flushSync(() => {
      setOpen(false);
      setChecking(false);
      setBlockers([]);
      setPassword("");
      setConfirmText("");
      setErrors({});
      setProblem(null);
    });
    triggerRef.current?.focus();
  }

  function showFieldErrors(found: FieldErrors) {
    flushSync(() => setErrors(found));
    (found.password ? passwordRef : confirmRef).current?.focus();
  }

  function showProblem(found: Notice) {
    flushSync(() => setProblem(found));
    problemRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setProblem(null);
    const found: FieldErrors = {
      password: password ? undefined : "Enter your current password.",
      confirm: isDeleteConfirmation(confirmText) ? undefined : `Type ${DELETE_CONFIRMATION} to confirm.`,
    };
    if (found.password || found.confirm) {
      showFieldErrors(found);
      return;
    }

    sending.current = true;
    setErrors({});
    setLoadingLabel("Deleting your account…");
    let leaving = false;
    try {
      const result = await accountRequest("/api/account/delete", "POST", { currentPassword: password, confirm: DELETE_CONFIRMATION });
      if (result.ok) {
        leaving = true;
        setLoadingLabel("Signing you out…");
        try {
          await signOut({ redirectTo: GOODBYE });
        } catch {
          // The account is closed and every session has ended on the server; this only clears this browser's cookie.
          window.location.assign(GOODBYE);
        }
      } else if (result.blockers.length) {
        flushSync(() => {
          setBlockers(result.blockers);
          setPassword("");
          setConfirmText("");
        });
        blockersRef.current?.focus();
      } else if (result.code === "WRONG_PASSWORD") {
        showFieldErrors({ password: result.error || "That isn’t your current password. Check it and try again." });
      } else if (result.code === "CONFIRMATION_REQUIRED") {
        showFieldErrors({ confirm: result.error || `Type ${DELETE_CONFIRMATION} to confirm.` });
      } else {
        showProblem({ tone: "error", message: problemMessage(result, "We couldn’t delete your account, and nothing has changed. Please try again."), signIn: result.status === 401 });
      }
    } finally {
      if (!leaving) {
        sending.current = false;
        setLoadingLabel(null);
      }
    }
  }

  return (
    <SettingsSection id="delete-account" icon="alert" tone="danger" title="Delete account" description="Close your PackAM account for good. This can’t be undone.">
      {!open ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => void openPanel()}
          className="pk-btn pk-btn-secondary border-packam-error/30 text-packam-error hover:border-packam-error/60"
        >
          Delete my account…
        </button>
      ) : (
        <div>
          <h3 ref={headingRef} tabIndex={-1} className="text-base font-black">Before you go</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[14px] border border-black/7 bg-packam-grey-50 p-4">
              <p className="text-sm font-black">We remove</p>
              <ul className="mt-2 space-y-2">
                {REMOVED.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[0.8125rem] leading-5 text-black/75">
                    <Icon name="close" className="mt-0.5 h-4 w-4 text-packam-error" strokeWidth={2.2} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[14px] border border-black/7 bg-packam-grey-50 p-4">
              <p className="text-sm font-black">We keep, for our records</p>
              <ul className="mt-2 space-y-2">
                {KEPT.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[0.8125rem] leading-5 text-black/75">
                    <Icon name="receipt" className="mt-0.5 h-4 w-4 text-black/55" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.8125rem] leading-5 text-black/60">We need these for accounting, refunds and to sort out any disputes.</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-black/70">
            You’ll be signed out on every device. You’re welcome to sign up again later, even with the same email and phone number.
          </p>

          {checking && blockers.length === 0 ? (
            <div className="mt-5 space-y-3">
              <p role="status" className="flex items-center gap-2 text-sm font-semibold text-black/65">
                <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-black/15 border-t-black/60 motion-safe:animate-spin" />
                Checking whether anything is still in progress…
              </p>
              <button type="button" onClick={closePanel} className="pk-btn pk-btn-ghost">Keep my account</button>
            </div>
          ) : blockers.length > 0 ? (
            <div className="mt-5 space-y-3">
              <FormAlert
                ref={blockersRef}
                tone="error"
                title="You can’t delete your account just yet"
                message={
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {blockers.map((blocker) => <li key={`${blocker.kind}:${blocker.message}`}>{blocker.message}</li>)}
                  </ul>
                }
              >
                <Link href="/support" className="inline-flex min-h-11 items-center underline decoration-black/30 underline-offset-4 hover:decoration-black">Contact support</Link>
                <button type="button" onClick={() => void checkAgain()} disabled={checking} className="inline-flex min-h-11 items-center underline decoration-black/30 underline-offset-4 hover:decoration-black disabled:no-underline">
                  {checking ? "Checking…" : "Check again"}
                </button>
              </FormAlert>
              <button type="button" onClick={closePanel} className="pk-btn pk-btn-ghost">Keep my account</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate aria-label="Delete your account" className="mt-5 space-y-5 border-t border-black/6 pt-5">
              {/* Tells password managers which account's password to fill. Unnamed, like every field here. */}
              <input type="email" autoComplete="username" value={email} readOnly hidden />
              <PasswordField
                ref={passwordRef}
                id="delete-password"
                label="Current password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
                }}
                error={errors.password}
              />
              <TextField
                ref={confirmRef}
                id="delete-confirm"
                label={<>Type <span className="font-black">{DELETE_CONFIRMATION}</span> to confirm</>}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                required
                value={confirmText}
                onChange={(event) => {
                  setConfirmText(event.target.value);
                  if (errors.confirm) setErrors((current) => ({ ...current, confirm: undefined }));
                }}
                error={errors.confirm}
              />
              {problem && <SettingsNotice ref={problemRef} notice={problem} />}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <SubmitButton loading={loadingLabel !== null} loadingLabel={loadingLabel ?? undefined} className="bg-packam-error hover:bg-packam-error/90 sm:w-auto">
                  Delete my account
                </SubmitButton>
                <button type="button" onClick={closePanel} disabled={loadingLabel !== null} className="pk-btn pk-btn-ghost pk-btn-lg text-base">Keep my account</button>
              </div>
            </form>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
