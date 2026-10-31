"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, type SignInResponse } from "next-auth/react";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { passwordProblem } from "../../lib/account/password-policy";
import { isValidEmail, nameProblem, normaliseEmail, normaliseName, phoneProblem } from "../../lib/account/validation";
import { AuthShell, authLinkClass } from "./AuthShell";
import { FormAlert } from "./FormAlert";
import { authHref, loginDestination, useAuthExit } from "./LoginForm";
import { PasswordChecklist } from "./PasswordChecklist";
import { PasswordField } from "./PasswordField";
import { SubmitButton } from "./SubmitButton";
import { TextField } from "./TextField";

type Field = "firstName" | "lastName" | "email" | "phone" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<Field, string>>;
/** A problem with the form as a whole. `taken` marks a 409, which offers ways into the account that already exists. */
type Problem = { message: string; taken?: "email" | "phone" };
/** How a submit ended without an account: problems under the fields, or one for the whole form. */
type Outcome = { fields: FieldErrors } | { problem: Problem };
/** The parts of an /api/register refusal this form reads. */
type Refusal = { message?: unknown; error?: unknown; code?: unknown; fields?: unknown };

/** Each field's id is its name; listed in the order the form shows them. */
const FIELDS: Field[] = ["firstName", "lastName", "email", "phone", "password", "confirmPassword"];
const PROBLEM_ID = "register-problem";
const NETWORK_ERROR = "We couldn’t reach PackAM. Check your connection and try again.";
/** The server's own SERVICE_UPDATING message talks about carts. */
const UPDATING = "PackAM is being updated, so we couldn’t create your account just now. Please try again in a few minutes.";

/**
 * Sign-up. Every field is checked the way /api/register checks it (the same helpers and words), with each problem
 * under its field, and the password gets a live checklist that knows the person's names and email. Once the account
 * exists, it signs in with what was just typed and plays the "Packed" animation on the way to the destination (the
 * callbackUrl when the role may go there, otherwise home). If that automatic sign-in fails, the account is still
 * there, so it goes to /login?registered=true, keeping the callbackUrl. A taken email or phone number offers
 * "Log in" and "Reset your password" instead.
 *
 * Like every auth form it has no method, action or field names, and its button waits for hydration.
 */
export function RegisterForm({ callbackUrl, emailConfirmation }: { callbackUrl?: string; emailConfirmation: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [phase, setPhase] = useState<"idle" | "creating" | "signing-in">("idle");
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const exit = useAuthExit();
  // What "doesn’t contain your name or email" compares against, normalised the way the server does it.
  const personal = { email: normaliseEmail(form.email), names: [normaliseName(form.firstName), normaliseName(form.lastName)] };
  const taken = problem?.taken;

  function update(field: Field, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    if (taken === field) setProblem(null);
  }

  /** Shows the problems under the fields before focusing the first, so it's read out with the field. */
  function showFieldErrors(found: FieldErrors) {
    flushSync(() => setErrors(found));
    const firstField = FIELDS.find((field) => found[field]);
    if (firstField) document.getElementById(firstField)?.focus();
  }

  /** Back to a usable form, showing why: under the fields, or in the alert, which takes focus so it's read out. */
  function stop(outcome: Outcome) {
    submitting.current = false;
    flushSync(() => setPhase("idle"));
    if ("fields" in outcome) {
      showFieldErrors(outcome.fields);
      return;
    }
    flushSync(() => setProblem(outcome.problem));
    alertRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setProblem(null);
    const found = problemsIn(form, personal);
    if (Object.keys(found).length > 0) {
      showFieldErrors(found);
      return;
    }

    submitting.current = true;
    setErrors({});
    setPhase("creating");
    const email = personal.email;
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, email, phone: form.phone, password: form.password }),
        cache: "no-store",
      });
      if (!response.ok) {
        const refusal: Refusal = await response.json().catch(() => ({}));
        stop(outcomeOf(response, refusal));
        return;
      }
    } catch {
      stop({ problem: { message: NETWORK_ERROR } });
      return;
    }

    // The account exists. Sign in with exactly what was typed; the form stays busy until the next page takes over.
    setPhase("signing-in");
    let result: SignInResponse | undefined;
    try {
      // A clean redirectTo: next-auth/react decides success by reading `error` and `code` from the URL it returns.
      result = await signIn("credentials", { identifier: email, password: form.password, redirect: false, redirectTo: "/login" });
    } catch {
      result = undefined;
    }
    if (!result || result.error) {
      // Logging in by hand still works.
      router.replace(authHref("/login", callbackUrl, { registered: "true" }));
      return;
    }
    const { destination } = await loginDestination(callbackUrl);
    if (formRef.current) exit.leave(formRef.current, `Welcome to PackAM, ${normaliseName(form.firstName)}`, destination);
  }

  return (
    <>
      {/* Once signed in, the page under the animation is out of reach, for keyboards and screen readers too. */}
      <div inert={exit.leaving}>
        <AuthShell
          title="Create your account"
          subtitle="Join PackAM, and what you need will meet you where you are."
          footer={<>Already have an account? <Link href={authHref("/login", callbackUrl)} className={authLinkClass}>Log in</Link></>}
        >
          <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
              <TextField
                id="firstName"
                label="First name"
                type="text"
                autoComplete="given-name"
                autoCapitalize="words"
                spellCheck={false}
                placeholder="Enter your first name"
                required
                value={form.firstName}
                onChange={(event) => update("firstName", event.target.value)}
                error={errors.firstName}
                // A little more room, so the whole placeholder fits in the two-column layout.
                inputClassName="sm:px-3.5"
              />
              <TextField
                id="lastName"
                label="Last name"
                type="text"
                autoComplete="family-name"
                autoCapitalize="words"
                spellCheck={false}
                placeholder="Enter your last name"
                required
                value={form.lastName}
                onChange={(event) => update("lastName", event.target.value)}
                error={errors.lastName}
                inputClassName="sm:px-3.5"
              />
            </div>
            <TextField
              id="email"
              label="Email address"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@example.com"
              required
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              error={errors.email}
              aria-invalid={taken === "email" || undefined}
              aria-describedby={taken === "email" ? PROBLEM_ID : undefined}
              hint={emailConfirmation ? "You’ll log in with it. We’ll email you a link to confirm it’s yours." : "You’ll log in with it."}
            />
            <TextField
              id="phone"
              label="Phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="08012345678"
              required
              value={form.phone}
              onChange={(event) => update("phone", event.target.value)}
              error={errors.phone}
              aria-invalid={taken === "phone" || undefined}
              aria-describedby={taken === "phone" ? PROBLEM_ID : undefined}
              hint="Runners call this number when they deliver. You can log in with it too."
            />
            <PasswordField
              id="password"
              label="Password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={(event) => update("password", event.target.value)}
              error={errors.password}
              aria-describedby="password-rules"
            >
              <PasswordChecklist id="password-rules" password={form.password} personal={personal} className="mt-3" />
            </PasswordField>
            <PasswordField
              id="confirmPassword"
              label="Confirm password"
              autoComplete="new-password"
              required
              value={form.confirmPassword}
              onChange={(event) => update("confirmPassword", event.target.value)}
              error={errors.confirmPassword}
            />
            {problem?.taken ? (
              <FormAlert ref={alertRef} id={PROBLEM_ID} tone="error" title={problem.message} message="Log in instead, or reset your password if you’ve forgotten it.">
                <Link href={authHref("/login", callbackUrl)} className={authLinkClass}>Log in</Link>
                <Link href={authHref("/forgot-password", callbackUrl)} className={authLinkClass}>Reset your password</Link>
              </FormAlert>
            ) : problem ? (
              <FormAlert ref={alertRef} id={PROBLEM_ID} tone="error">{problem.message}</FormAlert>
            ) : null}
            <SubmitButton loading={phase !== "idle"} loadingLabel={phase === "signing-in" ? "Signing you in…" : "Creating your account…"}>
              Create account
            </SubmitButton>
          </form>
        </AuthShell>
      </div>
      {exit.overlay}
    </>
  );
}

/** The problem with each field, in the words /api/register uses, plus the confirmation, which only the form has. */
function problemsIn(values: Record<Field, string>, personal: { email: string; names: string[] }): FieldErrors {
  const found: FieldErrors = {
    firstName: nameProblem(values.firstName, "first name") ?? undefined,
    lastName: nameProblem(values.lastName, "last name") ?? undefined,
    email: !personal.email ? "Enter your email address." : isValidEmail(personal.email) ? undefined : "Enter a valid email address, like you@example.com.",
    phone: phoneProblem(values.phone) ?? undefined,
    password: passwordProblem(values.password, personal) ?? undefined,
    confirmPassword: !values.confirmPassword
      ? "Type your password again."
      : values.confirmPassword !== values.password ? "The passwords don’t match. Type the same password in both boxes." : undefined,
  };
  return Object.fromEntries(Object.entries(found).filter(([, message]) => message)) as FieldErrors;
}

/** What a refused sign-up means for the form. */
function outcomeOf(response: Response, refusal: Refusal): Outcome {
  const message = typeof refusal.message === "string" ? refusal.message : typeof refusal.error === "string" ? refusal.error : "";
  if (refusal.code === "EMAIL_TAKEN") return { problem: { message: message || "An account with this email already exists.", taken: "email" } };
  if (refusal.code === "PHONE_TAKEN") return { problem: { message: message || "An account with this phone number already exists.", taken: "phone" } };
  const fields = fieldErrorsFrom(refusal.fields);
  if (Object.keys(fields).length > 0) return { fields };
  if (response.status === 429) {
    return { problem: { message: `Too many sign-up attempts from this network. Please try again ${retryWhen(response.headers.get("Retry-After"))}.` } };
  }
  if (refusal.code === "SERVICE_UPDATING") return { problem: { message: UPDATING } };
  return { problem: { message: message || "We couldn’t create your account. Please try again." } };
}

/** The server's problems per field, keeping only the fields this form has. */
function fieldErrorsFrom(value: unknown): FieldErrors {
  if (!value || typeof value !== "object") return {};
  const found: FieldErrors = {};
  for (const field of FIELDS) {
    const message = (value as Record<string, unknown>)[field];
    if (typeof message === "string" && message) found[field] = message;
  }
  return found;
}

/** "in about 12 minutes", from a Retry-After header in seconds. */
function retryWhen(retryAfter: string | null) {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return "a little later";
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "in a minute" : `in about ${minutes} minutes`;
}
