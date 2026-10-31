"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { nameProblem, normaliseName } from "../../lib/account/validation";
import { SubmitButton } from "../auth/SubmitButton";
import { TextField } from "../auth/TextField";
import { SettingsNotice, type Notice } from "./SettingsNotice";
import { SettingsSection } from "./SettingsSection";
import { accountRequest, problemMessage } from "./account-requests";

type Role = "STUDENT" | "RUNNER" | "ADMIN";
type FieldErrors = { firstName?: string; lastName?: string };

const ROLE_LABELS: Record<Role, string> = { STUDENT: "Student account", RUNNER: "Runner account", ADMIN: "Operations account" };

/** Who sees the name, so people know why it matters. */
const NAME_USE: Record<Role, string> = {
  STUDENT: "Your name appears on your orders and to the runner who delivers them.",
  RUNNER: "Your name appears to the students you deliver to.",
  ADMIN: "Your name appears on the changes you make in Operations.",
};

type ProfileSectionProps = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: Role;
  /** Already formatted on the server, e.g. "October 2026". */
  memberSince: string;
};

/**
 * Name (editable, checked like sign-up), plus the email, phone and join date for reference. Email changes have their
 * own section (they need a confirmation link); phone numbers can't be changed here yet, and the note says what to
 * do instead. Admins can't open support requests, so they aren't sent there.
 */
export function ProfileSection({ firstName, lastName, email, phone, role, memberSince }: ProfileSectionProps) {
  const router = useRouter();
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [saved, setSaved] = useState({ firstName, lastName });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);
  const sending = useRef(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const displayName = [saved.firstName, saved.lastName].filter(Boolean).join(" ") || email;
  const initial = (Array.from(displayName)[0] ?? "P").toUpperCase();

  /** Shows the problems under the fields before focusing the first one, so it's read out with its field. */
  function showFieldErrors(next: FieldErrors) {
    flushSync(() => setErrors(next));
    (next.firstName ? firstRef : lastRef).current?.focus();
  }

  /** Renders the message (and any other change) now, then moves focus to it so it's read out. */
  function showNotice(next: Notice, update?: () => void) {
    flushSync(() => {
      update?.();
      setNotice(next);
    });
    noticeRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setNotice(null);
    const next: FieldErrors = {
      firstName: nameProblem(first, "first name") ?? undefined,
      lastName: nameProblem(last, "last name") ?? undefined,
    };
    if (next.firstName || next.lastName) {
      showFieldErrors(next);
      return;
    }
    const body = { firstName: normaliseName(first), lastName: normaliseName(last) };
    setErrors({});
    if (body.firstName === saved.firstName && body.lastName === saved.lastName) {
      showNotice({ tone: "info", message: "That’s already your name, so there was nothing to save." }, () => {
        setFirst(body.firstName);
        setLast(body.lastName);
      });
      return;
    }

    sending.current = true;
    setLoading(true);
    try {
      const result = await accountRequest<{ firstName?: unknown; lastName?: unknown }>("/api/account/profile", "PATCH", body);
      if (result.ok) {
        const stored = {
          firstName: typeof result.data.firstName === "string" ? result.data.firstName : body.firstName,
          lastName: typeof result.data.lastName === "string" ? result.data.lastName : body.lastName,
        };
        showNotice({ tone: "success", message: "Saved. PackAM shows your new name from now on." }, () => {
          setSaved(stored);
          setFirst(stored.firstName);
          setLast(stored.lastName);
        });
        // Server-rendered pages and headers read the name fresh; this keeps this page's data in step too.
        router.refresh();
      } else if (result.code === "INVALID_NAME" && (result.fields.firstName || result.fields.lastName)) {
        showFieldErrors({ firstName: result.fields.firstName, lastName: result.fields.lastName });
      } else {
        showNotice({ tone: "error", message: problemMessage(result, "We couldn’t save your name. Please try again."), signIn: result.status === 401 });
      }
    } finally {
      sending.current = false;
      setLoading(false);
    }
  }

  return (
    <SettingsSection id="profile" icon="user" title="Profile" description={NAME_USE[role]}>
      <div className="flex items-center gap-3.5">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-packam-yellow text-lg font-black text-black">{initial}</span>
        <div className="min-w-0">
          <p className="truncate text-base font-black">{displayName}</p>
          <p className="text-sm leading-5 text-black/60">{ROLE_LABELS[role]} · Member since {memberSince}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-5">
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
          <TextField
            ref={firstRef}
            id="profile-first-name"
            label="First name"
            autoComplete="given-name"
            autoCapitalize="words"
            required
            value={first}
            onChange={(event) => {
              setFirst(event.target.value);
              if (errors.firstName) setErrors((current) => ({ ...current, firstName: undefined }));
            }}
            error={errors.firstName}
          />
          <TextField
            ref={lastRef}
            id="profile-last-name"
            label="Last name"
            autoComplete="family-name"
            autoCapitalize="words"
            required
            value={last}
            onChange={(event) => {
              setLast(event.target.value);
              if (errors.lastName) setErrors((current) => ({ ...current, lastName: undefined }));
            }}
            error={errors.lastName}
          />
        </div>
        {notice && <SettingsNotice ref={noticeRef} notice={notice} />}
        <SubmitButton loading={loading} loadingLabel="Saving…" className="sm:w-auto">Save name</SubmitButton>
      </form>

      <dl className="mt-6 divide-y divide-black/6 border-t border-black/6 text-sm">
        <div className="grid gap-1 py-3.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
          <dt className="font-bold text-black/60">Email</dt>
          <dd className="flex min-w-0 flex-wrap items-center justify-between gap-x-3">
            <span className="min-w-0 break-all font-semibold">{email}</span>
            <a href="#email" className="inline-flex min-h-11 items-center font-bold underline decoration-black/30 underline-offset-4 hover:decoration-black">
              Change<span className="sr-only"> your email</span>
            </a>
          </dd>
        </div>
        <div className="grid gap-1 py-3.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
          <dt className="font-bold text-black/60">Phone</dt>
          <dd className="min-w-0">
            <span className="break-all font-semibold">{phone || "No phone number yet"}</span>
            <p className="mt-1 text-[0.8125rem] leading-5 text-black/60">
              <PhoneNote role={role} hasPhone={Boolean(phone)} />
            </p>
          </dd>
        </div>
      </dl>
    </SettingsSection>
  );
}

/** Phone numbers can't be changed in settings yet: say why it matters and who can help. */
function PhoneNote({ role, hasPhone }: { role: Role; hasPhone: boolean }) {
  const support = <Link href="/support" className="font-bold text-black underline decoration-black/30 underline-offset-4 hover:decoration-black">contact support</Link>;
  if (role === "ADMIN") return <>Phone numbers can’t be changed here yet.</>;
  const who = role === "STUDENT" ? "Runners use" : "The PackAM team uses";
  const why = role === "STUDENT" ? " to reach you about deliveries." : " to reach you.";
  if (!hasPhone) return <>{who} your phone number{why} To add one, {support}.</>;
  return <>{who} this number{why} You can’t change it here yet, so {support} if it’s wrong.</>;
}
