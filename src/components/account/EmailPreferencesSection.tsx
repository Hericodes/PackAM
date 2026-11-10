"use client";

import { useState } from "react";
import { EMAIL_SCOPES, EMAIL_SCOPE_LABELS, type EmailScope } from "../../lib/email/campaign-rules";
import { SettingsSection } from "./SettingsSection";

type Preferences = Record<EmailScope, boolean>;

/**
 * Settings → Emails (students): one switch per kind of automated email. Each switch saves on its own; the server
 * answers with the stored values. They apply whether or not the address is confirmed.
 */
export function EmailPreferencesSection({ initial }: { initial: Preferences }) {
  const [preferences, setPreferences] = useState(initial);
  const [busy, setBusy] = useState<EmailScope | null>(null);
  const [error, setError] = useState("");

  async function toggle(scope: EmailScope) {
    if (busy) return;
    const next = !preferences[scope];
    setBusy(scope);
    setError("");
    setPreferences((current) => ({ ...current, [scope]: next }));
    try {
      const response = await fetch("/api/account/email-preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [scope]: next }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.preferences) throw new Error(typeof data.error === "string" ? data.error : "Your email settings couldn’t be saved. Try again.");
      setPreferences(data.preferences);
    } catch (cause) {
      setPreferences((current) => ({ ...current, [scope]: !next }));
      setError(cause instanceof Error ? cause.message : "Your email settings couldn’t be saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsSection id="emails" icon="mail" title="Emails from PackAM" description="Choose what PackAM emails you about. Every email also has a link to stop it.">
      <ul className="divide-y divide-black/5">
        {EMAIL_SCOPES.map((scope) => {
          const label = EMAIL_SCOPE_LABELS[scope];
          const on = preferences[scope];
          const id = `email-pref-${scope}`;
          return (
            <li key={scope} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p id={`${id}-label`} className="text-sm font-black">{label.title}</p>
                <p id={`${id}-description`} className="mt-0.5 text-sm leading-5 text-black/60">{label.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-labelledby={`${id}-label`}
                aria-describedby={`${id}-description`}
                onClick={() => void toggle(scope)}
                disabled={busy !== null}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-60 ${on ? "bg-black" : "bg-black/20"}`}
              >
                <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${on ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
    </SettingsSection>
  );
}
