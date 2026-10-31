import type { ReactNode, Ref } from "react";
import { Icon } from "../ui/Icon";

export type FormAlertTone = "error" | "success" | "info";

type FormAlertProps = {
  tone: FormAlertTone;
  /** Optional bold first line, e.g. "Check your email". */
  title?: ReactNode;
  /** The message. When it's given, children are follow-up actions; without it, children are the message. */
  message?: ReactNode;
  /** Follow-up links or buttons under the message, e.g. "Log in" and "Reset password". */
  children?: ReactNode;
  id?: string;
  className?: string;
  /** The alert takes focus (tabIndex -1, outside the tab order), so a form can move focus here after a failed submit. */
  ref?: Ref<HTMLDivElement>;
};

/** Tinted panels on the semantic tokens; the round badge and the words carry the meaning, never the colour alone. */
const TONES = {
  error: { panel: "border-packam-error/25 bg-packam-error-light", badge: "bg-packam-error text-white" },
  success: { panel: "border-packam-success/25 bg-packam-success-light", badge: "bg-packam-success text-white" },
  info: { panel: "border-packam-yellow/50 bg-packam-yellow-light", badge: "bg-packam-yellow text-black" },
} satisfies Record<FormAlertTone, { panel: string; badge: string }>;

/**
 * A message at form level: what went wrong, what worked, or something to know. Errors are role="alert" (read
 * out straight away); success and info are role="status" (read when the screen reader is free).
 */
export function FormAlert({ tone, title, message, children, id, className = "", ref }: FormAlertProps) {
  const hasMessage = message !== undefined && message !== null;
  const body = hasMessage ? message : children;
  const actions = hasMessage ? children : null;

  return (
    <div ref={ref} id={id} role={tone === "error" ? "alert" : "status"} tabIndex={-1} className={`flex scroll-mt-6 items-start gap-3 rounded-[14px] border px-4 py-3 text-sm leading-6 text-black/80 ${TONES[tone].panel} ${className}`}>
      <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-black ${TONES[tone].badge}`}>
        {tone === "success" ? <Icon name="check" className="h-3 w-3" strokeWidth={3.2} /> : tone === "error" ? "!" : "i"}
      </span>
      <div className="min-w-0 flex-1 wrap-break-word">
        {title && <p className="font-black text-black">{title}</p>}
        {body && <div>{body}</div>}
        {actions && <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-bold text-black">{actions}</div>}
      </div>
    </div>
  );
}
