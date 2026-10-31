"use client";

import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { isValidEmail, normaliseEmail } from "../../lib/account/validation";
import { FormAlert } from "./FormAlert";
import { SubmitButton } from "./SubmitButton";
import { TextField } from "./TextField";

type Stage = "form" | "sent" | "unavailable";

const NETWORK_ERROR = "We couldn’t reach PackAM. Check your connection and try again.";
/** The server's own SERVICE_UPDATING message talks about carts. */
const UPDATING = "PackAM is being updated. Please try again in a few minutes.";

/**
 * Asks for a password reset link. Whatever address is entered, a successful request ends on the same "check your
 * email" message: the server never says whether an account uses it. When PackAM can't send email at all
 * (`emailAvailable` false, or the server answers EMAIL_NOT_CONFIGURED), it says so instead of pretending.
 *
 * Like the other auth forms it has no method, action or field names, and the button waits for hydration.
 */
export function ForgotPasswordForm({ emailAvailable }: { emailAvailable: boolean }) {
  const [stage, setStage] = useState<Stage>(emailAvailable ? "form" : "unavailable");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const sending = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  /** Renders the change now, then moves focus to the message so it's read out and the next step is right there. */
  function showMessage(update: () => void) {
    flushSync(update);
    alertRef.current?.focus();
  }

  /** Shows the problem under the field before focusing it, so it's read out with the field. */
  function showFieldError(message: string) {
    flushSync(() => setFieldError(message));
    inputRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setFormError("");
    const address = normaliseEmail(email);
    if (!isValidEmail(address)) {
      showFieldError("Enter a valid email address, like you@example.com.");
      return;
    }

    sending.current = true;
    setFieldError("");
    setLoading(true);
    try {
      const response = await fetch("/api/account/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
        cache: "no-store",
      });
      const data: { error?: unknown; code?: unknown } = await response.json().catch(() => ({}));
      const message = typeof data.error === "string" ? data.error : "";
      if (response.ok) {
        showMessage(() => {
          setSentTo(address);
          setStage("sent");
        });
      } else if (data.code === "EMAIL_NOT_CONFIGURED") {
        showMessage(() => setStage("unavailable"));
      } else if (data.code === "INVALID_EMAIL") {
        showFieldError(message || "Enter a valid email address, like you@example.com.");
      } else if (response.status === 429) {
        showMessage(() => setFormError(`Too many reset requests from this network. Please try again ${retryWhen(response.headers.get("Retry-After"))}.`));
      } else if (data.code === "SERVICE_UPDATING") {
        showMessage(() => setFormError(UPDATING));
      } else {
        showMessage(() => setFormError(message || "Something went wrong. Please try again."));
      }
    } catch {
      showMessage(() => setFormError(NETWORK_ERROR));
    } finally {
      sending.current = false;
      setLoading(false);
    }
  }

  function startOver() {
    flushSync(() => {
      setStage("form");
      setEmail("");
      setFormError("");
    });
    inputRef.current?.focus();
  }

  if (stage === "unavailable") {
    return (
      <FormAlert
        ref={alertRef}
        tone="info"
        title="Reset by email isn’t available right now"
        message="PackAM can’t send password reset emails at the moment. Contact PackAM support and we’ll help you get back into your account."
      />
    );
  }

  if (stage === "sent") {
    return (
      <div className="space-y-5">
        <FormAlert ref={alertRef} tone="success" title="Check your email" message="If an account uses that email, we’ve sent a link. It expires in 30 minutes." />
        <p className="text-sm leading-6 text-black/70">
          Nothing after a few minutes? Look in your spam or junk folder, and check the address you entered:{" "}
          <span className="break-all font-bold text-black">{sentTo}</span>
        </p>
        <button type="button" onClick={startOver} className="pk-btn pk-btn-secondary pk-btn-lg w-full text-base">
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <TextField
        ref={inputRef}
        id="forgot-email"
        label="Email address"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="you@example.com"
        required
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          if (fieldError) setFieldError("");
        }}
        error={fieldError}
        hint="The email you signed up with. A phone number can’t be used here."
      />
      {formError && <FormAlert ref={alertRef} tone="error">{formError}</FormAlert>}
      <SubmitButton loading={loading} loadingLabel="Sending link…">Send reset link</SubmitButton>
    </form>
  );
}

/** "in about 12 minutes", from a Retry-After header in seconds. */
function retryWhen(retryAfter: string | null) {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return "a little later";
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "in a minute" : `in about ${minutes} minutes`;
}
