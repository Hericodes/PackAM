import Link from "next/link";
import type { Ref } from "react";
import { AuthShell } from "../auth/AuthShell";
import { FormAlert } from "../auth/FormAlert";
import { confirmEmailCopy, confirmEmailLinks, type ConfirmEmailOutcome, type ConfirmEmailViewer } from "./confirm-email";

type ConfirmEmailResultProps = {
  outcome: ConfirmEmailOutcome;
  viewer: ConfirmEmailViewer;
  /** The new address, masked (maskEmail), when the page knows it. */
  maskedEmail?: string;
  /** The message, so a form can move focus to it once the result arrives. */
  alertRef?: Ref<HTMLDivElement>;
};

/**
 * How a "confirm your new email" link ended, or why it can't be used: the heading, the message and where to go next,
 * signed in or out. Works in server and client components: /confirm-email renders it for links it can't use, and the
 * confirm form renders it once the button has been pressed.
 */
export function ConfirmEmailResult({ outcome, viewer, maskedEmail, alertRef }: ConfirmEmailResultProps) {
  const copy = confirmEmailCopy(outcome, maskedEmail, viewer.otherAccount);

  return (
    <AuthShell eyebrow="Email change" title={copy.title}>
      <FormAlert ref={alertRef} tone={copy.tone}>{copy.message}</FormAlert>
      <div className="mt-5 grid gap-3">
        {confirmEmailLinks(outcome, viewer).map((action, index) => (
          <Link key={action.href} href={action.href} className={`pk-btn pk-btn-lg w-full text-base ${index === 0 ? "pk-btn-primary" : "pk-btn-secondary"}`}>
            {action.label}
          </Link>
        ))}
      </div>
    </AuthShell>
  );
}
