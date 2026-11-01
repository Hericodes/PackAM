import Link from "next/link";
import type { Ref } from "react";
import { AuthShell } from "./AuthShell";
import { FormAlert } from "./FormAlert";
import { verifyEmailCopy, verifyEmailLinks, type VerifyEmailOutcome, type VerifyEmailViewer } from "./verify-email";

type VerifyEmailResultProps = {
  outcome: VerifyEmailOutcome;
  viewer: VerifyEmailViewer;
  /** The message, so a form can move focus to it once the result arrives. */
  alertRef?: Ref<HTMLDivElement>;
};

/**
 * How an email confirmation link ended, or why it can't be used: the heading, the message and where to go next,
 * signed in or out. Works in server and client components: /verify-email renders it for links it can't use, and the
 * confirm form renders it once the button has been pressed.
 */
export function VerifyEmailResult({ outcome, viewer, alertRef }: VerifyEmailResultProps) {
  const copy = verifyEmailCopy(outcome);

  return (
    <AuthShell eyebrow="Email confirmation" title={copy.title}>
      <FormAlert ref={alertRef} tone={copy.tone}>{copy.message}</FormAlert>
      <div className="mt-5 grid gap-3">
        {verifyEmailLinks(outcome, viewer).map((action, index) => (
          <Link key={action.href} href={action.href} className={`pk-btn pk-btn-lg w-full text-base ${index === 0 ? "pk-btn-primary" : "pk-btn-secondary"}`}>
            {action.label}
          </Link>
        ))}
      </div>
    </AuthShell>
  );
}
