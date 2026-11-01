"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { AuthShell } from "../auth/AuthShell";
import { FormAlert } from "../auth/FormAlert";
import { SubmitButton } from "../auth/SubmitButton";
import { ConfirmEmailResult } from "./ConfirmEmailResult";
import { accountRequest, problemMessage, type EmailChangeStatus } from "./account-requests";
import { confirmEmailAnswer, type ConfirmEmailViewer } from "./confirm-email";

const FAILED = "We couldn’t confirm your new email just now, and nothing has changed. Please try again.";

type ConfirmEmailFormProps = {
  token: string;
  /** The new address, masked (maskEmail): enough for its owner to recognise, without showing it to anyone else. */
  maskedEmail: string;
  viewer: ConfirmEmailViewer;
};

/**
 * The "Confirm new email" step for a link /confirm-email has already checked: nothing changes until the button is
 * pressed, so a mail scanner or link preview opening the link can't confirm it. The token arrives as a prop and is
 * taken out of the address bar as soon as the page loads, so it can't be bookmarked, shared or reopened from history.
 * The button POSTs it to /api/account/email/confirm, signed in or out, and every answer is shown here with where to go
 * next; a failure that left the link unused keeps the button, so it can be pressed again.
 *
 * Like every auth form it has no method or action, and its button waits for hydration.
 */
export function ConfirmEmailForm({ token, maskedEmail, viewer }: ConfirmEmailFormProps) {
  const [result, setResult] = useState<EmailChangeStatus | null>(null);
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
      const answer = await accountRequest("/api/account/email/confirm", "POST", { token });
      const status = answer.ok ? confirmEmailAnswer(answer.data) : "error";
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

  if (result) return <ConfirmEmailResult outcome={result} viewer={viewer} maskedEmail={maskedEmail} alertRef={alertRef} />;

  return (
    <AuthShell
      eyebrow="Email change"
      title="Confirm your new email"
      subtitle={
        viewer.otherAccount ? (
          <>This link is for a different PackAM account from the one you’re signed in to. Confirming changes that account’s email to <span className="break-all font-bold text-black">{maskedEmail}</span>.</>
        ) : (
          <>Your PackAM account will use <span className="break-all font-bold text-black">{maskedEmail}</span> once you confirm.</>
        )
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <p className="text-[0.9375rem] leading-6 text-black/75">
          Until you confirm, your account keeps using its current email. Afterwards, you’ll log in with the new one.
        </p>
        {error && <FormAlert ref={alertRef} tone="error">{error}</FormAlert>}
        <SubmitButton loading={loading} loadingLabel="Confirming…">Confirm new email</SubmitButton>
      </form>
      <p className="mt-4 text-sm leading-6 text-black/65">Didn’t ask for this? You can close this page: nothing changes unless you confirm.</p>
    </AuthShell>
  );
}
