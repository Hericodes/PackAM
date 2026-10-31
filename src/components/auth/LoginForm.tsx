"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, type SignInResponse } from "next-auth/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { loginErrorMessage } from "../../lib/account/login-errors";
import { AuthShell, authLinkClass } from "./AuthShell";
import { AuthSuccess, type PackSource } from "./AuthSuccess";
import { FormAlert, type FormAlertTone } from "./FormAlert";
import { measureAuthLogo, measurePackSources } from "./pack-sources";
import { PasswordField } from "./PasswordField";
import { SubmitButton } from "./SubmitButton";
import { TextField } from "./TextField";

/**
 * The banners /login can show, one per query parameter the other pages send: ?registered=true, ?reset=done,
 * ?verified=1, ?emailChanged=1 and ?signedOut=1. Never `error` or `code`: next-auth/react reads those from the URL
 * a sign-in returns to.
 */
export type LoginNotice = "registered" | "reset" | "verified" | "emailChanged" | "signedOut";

const NOTICES: Record<LoginNotice, { tone: FormAlertTone; title: string; message: string }> = {
  registered: { tone: "success", title: "Your account is ready", message: "Log in with your email or phone number and the password you just chose." },
  reset: { tone: "success", title: "Password changed", message: "You’ve been signed out on every device. Log in with your new password." },
  verified: { tone: "success", title: "Email confirmed", message: "Thanks for confirming your email address. Log in to carry on." },
  emailChanged: { tone: "success", title: "Email changed", message: "Your new email address is confirmed. Use it, or your phone number, to log in." },
  signedOut: { tone: "info", title: "You’re signed out", message: "Log in again whenever you’re ready." },
};

type FieldErrors = { identifier?: string; password?: string };

/** "Forgot password?" in the password's label row: small text with a 40px-tall tap area that doesn't push the row apart. */
const asideLinkClass =
  "relative inline-block text-sm font-bold text-black underline decoration-black/30 underline-offset-4 transition-colors hover:decoration-black before:absolute before:-inset-x-2 before:-top-3 before:-bottom-2";

/**
 * Log in with an email or phone number and a password. next-auth/react signs in; the "Packed" animation plays only
 * once the server has confirmed it, then the person lands where /api/login-destination says (their callbackUrl if
 * their role may go there, otherwise their role's home). A failure keeps them here with the reason in a focused
 * alert. The password is sent exactly as typed: existing passwords were never trimmed or held to today's rules.
 *
 * Like every auth form it has no method, action or field names, and its button waits for hydration, so a submit
 * before the page has loaded can never put the password in a URL. The sign-up and password reset links carry the
 * callbackUrl.
 */
export function LoginForm({ callbackUrl, notice }: { callbackUrl?: string; notice?: LoginNotice }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const exit = useAuthExit();
  const banner = notice ? NOTICES[notice] : null;

  /** Shows the problems under the fields before focusing the first, so it's read out with the field. */
  function showFieldErrors(next: FieldErrors) {
    flushSync(() => setErrors(next));
    (next.identifier ? identifierRef : passwordRef).current?.focus();
  }

  /** Back to a usable form, with the reason in the alert, which takes focus so it's read out. */
  function fail(message: string) {
    submitting.current = false;
    flushSync(() => {
      setFormError(message);
      setLoading(false);
    });
    alertRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setFormError("");
    const next: FieldErrors = {
      identifier: identifier.trim() ? undefined : "Enter your email or phone number.",
      password: password ? undefined : "Enter your password.",
    };
    if (next.identifier || next.password) {
      showFieldErrors(next);
      return;
    }

    submitting.current = true;
    setErrors({});
    setLoading(true);
    let result: SignInResponse | undefined;
    try {
      // A clean redirectTo: next-auth/react decides success by reading `error` and `code` from the URL it returns.
      result = await signIn("credentials", { identifier: identifier.trim(), password, redirect: false, redirectTo: "/login" });
    } catch {
      result = undefined;
    }
    // No result at all means PackAM couldn't be reached; loginErrorMessage says so.
    if (!result || result.error) {
      fail(loginErrorMessage(result?.code, result?.error));
      return;
    }

    // Signed in. From here the form stays busy until the next page takes over.
    const { destination, firstName } = await loginDestination(callbackUrl);
    if (formRef.current) exit.leave(formRef.current, firstName ? `Welcome back, ${firstName}` : "Welcome back", destination);
  }

  return (
    <>
      {/* Once signed in, the page under the animation is out of reach, for keyboards and screen readers too. */}
      <div inert={exit.leaving}>
        <AuthShell
          title="Welcome back"
          subtitle="Log in and let PackAM do the running around for you."
          footer={<>Don’t have an account? <Link href={authHref("/register", callbackUrl)} className={authLinkClass}>Create one</Link></>}
        >
          {banner && <FormAlert tone={banner.tone} title={banner.title} message={banner.message} className="mb-5" />}
          <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-5">
            <TextField
              ref={identifierRef}
              id="identifier"
              label="Email or phone number"
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@example.com or 08012345678"
              required
              value={identifier}
              onChange={(event) => {
                setIdentifier(event.target.value);
                if (errors.identifier) setErrors((current) => ({ ...current, identifier: undefined }));
              }}
              error={errors.identifier}
            />
            <PasswordField
              ref={passwordRef}
              id="password"
              label="Password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
              }}
              error={errors.password}
              labelAside={<Link href={authHref("/forgot-password", callbackUrl)} className={asideLinkClass}>Forgot password?</Link>}
            />
            {formError && <FormAlert ref={alertRef} tone="error">{formError}</FormAlert>}
            <SubmitButton loading={loading} loadingLabel="Logging you in…">Log in</SubmitButton>
          </form>
        </AuthShell>
      </div>
      {exit.overlay}
    </>
  );
}

// ---- Shared with RegisterForm: where a new session goes, and how it gets there ----

/**
 * `path` with the page's callbackUrl (and any `params`) in its query, so moving between log in, sign up and
 * recovery never loses where the person was going. /api/login-destination checks it against their role later.
 */
export function authHref(path: string, callbackUrl: string | undefined, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params);
  if (callbackUrl) query.set("callbackUrl", callbackUrl);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * Where a session that has just started goes: the callbackUrl when the person's role may land there, otherwise
 * their role's home (GET /api/login-destination decides). The sign-in has already worked, so when that can't be
 * asked the answer is "/" rather than an error: nobody is left on the form. `firstName` is used when the API offers one.
 */
export async function loginDestination(callbackUrl: string | undefined): Promise<{ destination: string; firstName: string | null }> {
  try {
    const query = callbackUrl ? `?${new URLSearchParams({ callbackUrl })}` : "";
    const response = await fetch(`/api/login-destination${query}`, { cache: "no-store" });
    const data: { destination?: unknown; firstName?: unknown } = await response.json();
    // The server only answers internal paths; checked again because router.replace must never get anything else.
    if (response.ok && isInternalPath(data.destination)) {
      const firstName = typeof data.firstName === "string" ? data.firstName.trim() : "";
      return { destination: data.destination, firstName: firstName || null };
    }
  } catch {
    // Offline, or an answer that isn't JSON: the home page below.
  }
  return { destination: "/", firstName: null };
}

function isInternalPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

type Exit = { greeting: string; destination: string; sources: PackSource[]; logo: PackSource | null };

/** After the animation, how long router.replace gets before the destination is loaded outright. */
const HARD_NAVIGATION_MS = 4000;

/**
 * The end of a successful sign-in or sign-up: <AuthSuccess> over the page, then the destination. Call leave() only
 * once the server has confirmed the sign-in, and only once: it measures the form there and then and keeps the result,
 * so the animation's props never change (it would restart if they did). Render `overlay`, and make the page under it
 * inert while `leaving`. The destination opens with router.replace; if this page is still here 4 seconds later (a
 * slow or stuck navigation), it is loaded outright instead.
 */
export function useAuthExit() {
  const router = useRouter();
  const [exit, setExit] = useState<Exit | null>(null);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const destination = exit?.destination ?? "/";

  // Stable once leave() has run, as AuthSuccess needs.
  const finish = useCallback(() => {
    router.replace(destination);
    setNavigatingTo(destination);
  }, [router, destination]);

  // The destination replacing this page unmounts it, which cancels the fallback.
  useEffect(() => {
    if (!navigatingTo) return;
    const fallback = window.setTimeout(() => window.location.assign(navigatingTo), HARD_NAVIGATION_MS);
    return () => window.clearTimeout(fallback);
  }, [navigatingTo]);

  const leave = useCallback((form: HTMLFormElement, greeting: string, to: string) => {
    setExit({ greeting, destination: to, sources: measurePackSources(form), logo: measureAuthLogo() });
  }, []);

  const overlay = exit ? <AuthSuccess greeting={exit.greeting} sources={exit.sources} logoFrom={exit.logo} onFinish={finish} /> : null;
  return { leaving: exit !== null, leave, overlay };
}
