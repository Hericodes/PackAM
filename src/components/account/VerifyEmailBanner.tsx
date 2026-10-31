"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Icon } from "../ui/Icon";
import { accountRequest, problemMessage } from "./account-requests";

type Result = { tone: "success" | "error"; message: string; signIn?: boolean };

type VerifyEmailBannerProps = {
  email: string;
  /**
   * Called when the server says the address is already verified (say, from the link in another tab). Settings
   * passes it to update its badge and drops the banner; without it, the banner says so itself.
   */
  onVerified?: () => void;
  /** A second action after "Send a new link", e.g. a link to Settings from the account page. */
  action?: ReactNode;
  /** The page to come back to when the session has ended and the person logs in again. */
  returnTo?: string;
  className?: string;
};

/**
 * A small reminder that the account's email isn't verified yet, with a button that sends a new link
 * (POST /api/account/verify-email/resend: 60 seconds apart, 3 an hour). Only shown where email can go out.
 * The answer appears under the button and takes focus, so screen readers read it.
 */
export function VerifyEmailBanner({ email, onVerified, action, returnTo = "/settings", className = "" }: VerifyEmailBannerProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const busy = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);

  function show(next: Result) {
    flushSync(() => setResult(next));
    resultRef.current?.focus();
  }

  async function resend() {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setResult(null);
    try {
      const response = await accountRequest<{ status?: unknown }>("/api/account/verify-email/resend", "POST", {});
      if (response.ok && response.data.status === "already-verified") {
        if (onVerified) {
          onVerified();
          return;
        }
        show({ tone: "success", message: "Your email is already verified. Thanks!" });
      } else if (response.ok) {
        setSent(true);
        show({ tone: "success", message: `Sent! Check ${email} for a new link. It works for 24 hours, and if it isn’t there in a few minutes, look in your spam folder.` });
      } else {
        show({ tone: "error", message: problemMessage(response, "We couldn’t send a new link. Please try again."), signIn: response.status === 401 });
      }
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  const verified = result?.tone === "success" && !sent;

  return (
    <div className={`rounded-[14px] border border-packam-yellow/50 bg-packam-yellow-light px-4 py-3.5 ${className}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-packam-yellow text-black">
          <Icon name="mail" className="h-4 w-4" strokeWidth={2.1} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-black">Verify your email address</p>
          <p className="mt-0.5 text-sm leading-6 text-black/75">
            Open the link we sent to <span className="break-all font-bold text-black">{email}</span>, so PackAM can reach you about your account, for example if you need to reset your password.
          </p>
          {!verified && (
            <div className="mt-1 flex flex-wrap items-center gap-x-5">
              <button
                type="button"
                onClick={() => void resend()}
                disabled={sending}
                aria-busy={sending || undefined}
                className="inline-flex min-h-11 items-center text-sm font-bold text-black underline decoration-black/30 underline-offset-4 transition-colors hover:decoration-black disabled:cursor-progress disabled:no-underline disabled:opacity-60"
              >
                {sending ? "Sending…" : sent ? "Send another link" : "Send a new link"}
              </button>
              {action}
            </div>
          )}
          {result && (
            <p
              ref={resultRef}
              tabIndex={-1}
              role={result.tone === "error" ? "alert" : "status"}
              className={`mt-1 flex items-start gap-1.5 text-sm font-semibold leading-6 ${result.tone === "error" ? "text-packam-error" : "text-packam-success"}`}
            >
              <Icon name={result.tone === "error" ? "alert" : "check"} className="mt-1 h-4 w-4" strokeWidth={2.2} />
              <span>
                {result.message}
                {result.signIn && (
                  <>
                    {" "}
                    <Link href={`/login?callbackUrl=${encodeURIComponent(returnTo)}`} className="font-bold text-black underline underline-offset-4">Log in again</Link>
                  </>
                )}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
