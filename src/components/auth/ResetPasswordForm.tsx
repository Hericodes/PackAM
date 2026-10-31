"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { passwordProblem } from "../../lib/account/password-policy";
import { FormAlert } from "./FormAlert";
import { PasswordChecklist } from "./PasswordChecklist";
import { PasswordField } from "./PasswordField";
import { SubmitButton } from "./SubmitButton";

type FieldErrors = { password?: string; confirm?: string };
type LinkProblem = { title: string; message: string };

const NETWORK_ERROR = "We couldn’t reach PackAM. Check your connection and try again.";
/** The server's own SERVICE_UPDATING message talks about carts. */
const UPDATING = "PackAM is being updated. Your password hasn’t changed. Please try again in a few minutes.";
/** The link codes the reset API answers with, and the heading for each. Its own message says what to do. */
const LINK_TITLES = new Map([
  ["INVALID_TOKEN", "This link isn’t valid"],
  ["EXPIRED_TOKEN", "This link has expired"],
  ["USED_TOKEN", "This link has already been used"],
]);

/**
 * The new-password step of a reset, for a link the page has already checked. The token arrives as a prop and is
 * taken out of the address bar as soon as the page loads, so it can't be bookmarked, shared or reopened from
 * history (a refresh then asks for the emailed link again). On success every device is signed out, so it goes to
 * /login?reset=done.
 *
 * `email` and `names` feed the "doesn't contain your name or email" rule, and the email sits in a hidden username
 * field so password managers save the new password against the right account.
 */
export function ResetPasswordForm({ token, email, names }: { token: string; email: string; names: string[] }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [linkProblem, setLinkProblem] = useState<LinkProblem | null>(null);
  const [loading, setLoading] = useState(false);
  const sending = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const personal = { email, names };

  // The token is in this component's props now, so it comes out of the address bar and this history entry.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("token")) return;
    url.searchParams.delete("token");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  /** Renders the message now, then moves focus to it so it's read out. */
  function showMessage(update: () => void) {
    flushSync(update);
    alertRef.current?.focus();
  }

  function showFieldErrors(next: FieldErrors) {
    flushSync(() => setErrors(next));
    (next.password ? passwordRef : confirmRef).current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setFormError("");
    const next: FieldErrors = {
      password: passwordProblem(password, personal) ?? undefined,
      confirm: !confirm ? "Type your new password again." : confirm !== password ? "The passwords don’t match. Type the same password in both boxes." : undefined,
    };
    if (next.password || next.confirm) {
      showFieldErrors(next);
      return;
    }

    sending.current = true;
    setErrors({});
    setLoading(true);
    let leaving = false;
    try {
      const response = await fetch("/api/account/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
        cache: "no-store",
      });
      const data: { error?: unknown; code?: unknown } = await response.json().catch(() => ({}));
      const message = typeof data.error === "string" ? data.error : "";
      const linkTitle = typeof data.code === "string" ? LINK_TITLES.get(data.code) : undefined;
      if (response.ok) {
        // Stays busy until the login page takes over.
        leaving = true;
        router.replace("/login?reset=done");
      } else if (data.code === "WEAK_PASSWORD") {
        showFieldErrors({ password: message || "Choose a different password." });
      } else if (linkTitle) {
        showMessage(() => setLinkProblem({ title: linkTitle, message: message || "Request a new link to reset your password." }));
      } else if (response.status === 429) {
        showMessage(() => setFormError(`Too many attempts from this network. Please try again ${retryWhen(response.headers.get("Retry-After"))}.`));
      } else if (data.code === "SERVICE_UPDATING") {
        showMessage(() => setFormError(UPDATING));
      } else {
        showMessage(() => setFormError(message || "We couldn’t save your new password. Please try again."));
      }
    } catch {
      showMessage(() => setFormError(NETWORK_ERROR));
    } finally {
      if (!leaving) {
        sending.current = false;
        setLoading(false);
      }
    }
  }

  if (linkProblem) {
    return (
      <div className="space-y-5">
        <FormAlert ref={alertRef} tone="error" title={linkProblem.title} message={linkProblem.message} />
        <div className="grid gap-3">
          <Link href="/forgot-password" className="pk-btn pk-btn-primary pk-btn-lg w-full text-base">Request a new link</Link>
          <Link href="/login" className="pk-btn pk-btn-secondary pk-btn-lg w-full text-base">Log in</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Tells password managers which account the new password is for. Unnamed, like every field here. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <PasswordField
        ref={passwordRef}
        id="new-password"
        label="New password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
        }}
        error={errors.password}
        aria-describedby="new-password-rules"
      >
        <PasswordChecklist id="new-password-rules" password={password} personal={personal} className="mt-3" />
      </PasswordField>
      <PasswordField
        ref={confirmRef}
        id="confirm-password"
        label="Confirm new password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(event) => {
          setConfirm(event.target.value);
          if (errors.confirm) setErrors((current) => ({ ...current, confirm: undefined }));
        }}
        error={errors.confirm}
      />
      {formError && <FormAlert ref={alertRef} tone="error">{formError}</FormAlert>}
      <SubmitButton loading={loading} loadingLabel="Saving your password…">Save new password</SubmitButton>
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
