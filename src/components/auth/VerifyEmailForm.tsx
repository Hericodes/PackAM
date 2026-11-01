"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { accountRequest, problemMessage } from "../account/account-requests";
import { AuthShell } from "./AuthShell";
import { FormAlert } from "./FormAlert";
import { SubmitButton } from "./SubmitButton";
import { VerifyEmailResult } from "./VerifyEmailResult";
import { verifyEmailAnswer, type VerifyStatus, type VerifyEmailViewer } from "./verify-email";

const FAILED = "We couldn’t confirm your email just now, and your link hasn’t been used. Please try again.";

type VerifyEmailFormProps = {
  token: string;
  /** The address the link was sent to, masked (maskEmail): enough for its owner to recognise. */
  maskedEmail: string;
  viewer: VerifyEmailViewer;
};

/**
 * The "Confirm my email" step for a link /verify-email has already checked: nothing is confirmed until the button is
 * pressed, so a mail scanner or link preview opening the link can't confirm someone else's address. The token arrives
 * as a prop and is taken out of the address bar as soon as the page loads, so it can't be bookmarked, shared or
 * reopened from history. The button POSTs it to /api/account/verify-email, signed in or out, and every answer is shown
 * here with where to go next; a failure that left the link unused keeps the button, so it can be pressed again.
 *
 * Like every auth form it has no method or action, and its button waits for hydration.
 */
export function VerifyEmailForm({ token, maskedEmail, viewer }: VerifyEmailFormProps) {
  const [result, setResult] = useState<VerifyStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sending = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);

  // The token is in this component's props now, so it comes out of the address bar and this history entry.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("token")) return;
    url.searchParams.delete("token");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setError("");
    setLoading(true);
    try {
      const answer = await accountRequest("/api/account/verify-email", "POST", { token });
      const status = answer.ok ? verifyEmailAnswer(answer.data) : "error";
      // Rendered now, then focused, so the result is read out.
      flushSync(() => {
        if (status !== "error") setResult(status);
        else setError(answer.ok ? FAILED : problemMessage(answer, FAILED));
      });
      alertRef.current?.focus();
    } finally {
      sending.current = false;
      setLoading(false);
    }
  }

  if (result) return <VerifyEmailResult outcome={result} viewer={viewer} alertRef={alertRef} />;

  return (
    <AuthShell
      eyebrow="Email confirmation"
      title="Confirm your email"
      subtitle={<>Confirm that <span className="break-all font-bold text-black">{maskedEmail}</span> is your email address.</>}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <p className="text-[0.9375rem] leading-6 text-black/75">
          Once it’s confirmed, PackAM can reach you about your account, for example to help you reset your password.
        </p>
        {error && <FormAlert ref={alertRef} tone="error">{error}</FormAlert>}
        <SubmitButton loading={loading} loadingLabel="Confirming…">Confirm my email</SubmitButton>
      </form>
      <p className="mt-4 text-sm leading-6 text-black/65">Didn’t sign up for PackAM? You can close this page: nothing happens unless you confirm.</p>
    </AuthShell>
  );
}
