"use client";

import { signOut } from "next-auth/react";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { PasswordField } from "../auth/PasswordField";
import { SubmitButton } from "../auth/SubmitButton";
import { Icon } from "../ui/Icon";
import { SettingsNotice, type Notice } from "./SettingsNotice";
import { SettingsSection } from "./SettingsSection";
import { accountRequest, problemMessage } from "./account-requests";
import { LOG_IN_AGAIN, signInAgain } from "./sign-in-again";

type Scope = "others" | "all";

const SIGNED_OUT = "/login?signedOut=1";

const SCOPES: Record<Scope, { title: string; detail: string; submit: string; busy: string }> = {
  others: {
    title: "Sign out of other devices",
    detail: "Every other phone, tablet and browser is signed out. You stay signed in here.",
    submit: "Sign out other devices",
    busy: "Signing out other devices…",
  },
  all: {
    title: "Sign out everywhere",
    detail: "Every device is signed out, including this one.",
    submit: "Sign out everywhere",
    busy: "Signing out everywhere…",
  },
};

/**
 * Sessions are signed cookies that PackAM doesn't keep a list of, so devices can't be shown or signed out one by
 * one, and the copy says so. Both choices end every session on the server (after the current password); for
 * "other devices" this browser then signs straight back in with that password, for "everywhere" it signs out too.
 */
export function DevicesSection({ email }: { email: string }) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [problem, setProblem] = useState<Notice | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);
  const sending = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Partial<Record<Scope, HTMLButtonElement | null>>>({});

  function showError(message: string) {
    flushSync(() => setError(message));
    passwordRef.current?.focus();
  }

  function showProblem(found: Notice) {
    flushSync(() => setProblem(found));
    problemRef.current?.focus();
  }

  function choose(next: Scope) {
    flushSync(() => {
      setScope(next);
      setNotice(null);
      setProblem(null);
      setError("");
    });
    passwordRef.current?.focus();
  }

  function reset() {
    setScope(null);
    setPassword("");
    setError("");
    setProblem(null);
  }

  function cancel() {
    const chosen = scope;
    flushSync(reset);
    if (chosen) triggerRefs.current[chosen]?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !scope) return;
    setProblem(null);
    if (!password) {
      showError("Enter your current password.");
      return;
    }

    sending.current = true;
    setError("");
    setLoading(true);
    let leaving = false;
    try {
      const result = await accountRequest("/api/account/sessions", "POST", { action: scope, currentPassword: password });
      if (result.ok && scope === "all") {
        leaving = true;
        try {
          await signOut({ redirectTo: SIGNED_OUT });
        } catch {
          // Every session has already ended on the server; signOut only clears this browser's cookie. Load the login
          // page afresh anyway, replacing this page in history.
          window.location.replace(SIGNED_OUT);
        }
      } else if (result.ok) {
        // Every session just ended, this one too: sign back in with the same password to stay signed in here.
        if (await signInAgain(email, password)) {
          flushSync(() => {
            reset();
            setNotice({ tone: "success", title: "Other devices signed out", message: "Anyone using your account on another device will need your password to log in again. You’re still signed in here." });
          });
          noticeRef.current?.focus();
        } else {
          // Signed out here as well now: a fresh login page, so nothing signed-in is left in this tab's memory.
          leaving = true;
          window.location.replace(LOG_IN_AGAIN);
        }
      } else if (result.code === "WRONG_PASSWORD") {
        showError(result.error || "That isn’t your current password. Check it and try again.");
      } else {
        showProblem({ tone: "error", message: problemMessage(result, "We couldn’t sign out your devices. Please try again."), signIn: result.status === 401 });
      }
    } finally {
      if (!leaving) {
        sending.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <SettingsSection
      id="devices"
      icon="smartphone"
      title="Devices"
      description="PackAM can’t show a list of the devices you’re signed in on. If you used PackAM on a phone or computer you no longer have, or you think someone else is signed in as you, sign out here."
    >
      {notice && <SettingsNotice ref={noticeRef} notice={notice} className="mb-4" />}

      {scope ? (
        <form onSubmit={handleSubmit} noValidate aria-labelledby="devices-confirm-heading" className="space-y-5">
          <div>
            <h3 id="devices-confirm-heading" className="text-base font-black">{SCOPES[scope].title}</h3>
            <p className="mt-1 text-sm leading-6 text-black/65">{SCOPES[scope].detail}</p>
          </div>
          {/* Tells password managers which account's password to fill. Unnamed, like every field here. */}
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <PasswordField
            ref={passwordRef}
            id="devices-password"
            label="Current password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) setError("");
            }}
            error={error}
            hint="So we know it’s really you."
          />
          {problem && <SettingsNotice ref={problemRef} notice={problem} />}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SubmitButton loading={loading} loadingLabel={SCOPES[scope].busy} className="sm:w-auto">{SCOPES[scope].submit}</SubmitButton>
            <button type="button" onClick={cancel} disabled={loading} className="pk-btn pk-btn-ghost pk-btn-lg text-base">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(SCOPES) as Scope[]).map((option) => (
            <button
              key={option}
              ref={(element) => { triggerRefs.current[option] = element; }}
              type="button"
              onClick={() => choose(option)}
              className="group flex min-h-11 items-start gap-3 rounded-[14px] border border-black/10 bg-white p-4 text-left transition-colors hover:border-black/30"
            >
              <Icon name={option === "all" ? "logout" : "smartphone"} className="mt-0.5 h-5 w-5 text-black/70" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black">{SCOPES[option].title}</span>
                <span className="mt-0.5 block text-[0.8125rem] leading-5 text-black/60">{SCOPES[option].detail}</span>
              </span>
              <Icon name="chevronRight" className="mt-0.5 h-4 w-4 text-black/35 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </button>
          ))}
        </div>
      )}

      <p className="mt-4 text-[0.8125rem] leading-5 text-black/60">
        Think someone knows your password? <a href="#password" className="font-bold text-black underline decoration-black/30 underline-offset-4 hover:decoration-black">Change it</a> instead: that signs out your other devices too.
      </p>
    </SettingsSection>
  );
}
