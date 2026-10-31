import Link from "next/link";
import type { Ref } from "react";
import { FormAlert, type FormAlertTone } from "../auth/FormAlert";

/** What a settings section says after an action. `signIn` adds a way to log in again (the session had ended). */
export type Notice = { tone: FormAlertTone; message: string; title?: string; signIn?: boolean };

/**
 * A section's message after something was saved or went wrong, on the shared FormAlert. Focusable (tabIndex -1),
 * so the section can move focus here and screen readers read it out.
 */
export function SettingsNotice({ notice, returnTo = "/settings", className = "", ref }: { notice: Notice; returnTo?: string; className?: string; ref?: Ref<HTMLDivElement> }) {
  return (
    <FormAlert ref={ref} tone={notice.tone} title={notice.title} message={notice.message} className={className}>
      {notice.signIn && (
        <Link href={`/login?callbackUrl=${encodeURIComponent(returnTo)}`} className="inline-flex min-h-11 items-center underline decoration-black/30 underline-offset-4 hover:decoration-black">
          Log in again
        </Link>
      )}
    </FormAlert>
  );
}
