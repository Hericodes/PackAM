"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { Icon } from "../ui/Icon";

/**
 * A labelled input for the auth and account forms: a visible label, .pk-input, and an optional hint and error
 * that screen readers hear with the field (aria-describedby); an error also marks it invalid. Everything else
 * (value, onChange, type, autoComplete, inputMode, autoCapitalize, spellCheck, required, disabled, readOnly,
 * ref…) goes straight to the <input>. There's no name attribute unless one is passed: these forms submit with
 * JavaScript, and an unnamed field can never end up in a URL if someone submits before the page has loaded.
 */
export type TextFieldProps = Omit<ComponentProps<"input">, "id" | "className" | "children"> & {
  label: ReactNode;
  /** A generated id is used when none is given. The hint and error get `${id}-hint` and `${id}-error`. */
  id?: string;
  /** Help under the field, e.g. what the address is used for. */
  hint?: ReactNode;
  /** What's wrong with the value, in plain words (inline content only). Anything falsy means it's fine. */
  error?: ReactNode;
  /** Shown at the end of the label row, e.g. a "Forgot password?" link. */
  labelAside?: ReactNode;
  /** A control inside the field's right edge, such as PasswordField's eye; make room with inputClassName. */
  trailing?: ReactNode;
  /** Shown under the hint, e.g. a password checklist. */
  children?: ReactNode;
  /** Classes for the wrapper (spacing, grid placement). */
  className?: string;
  /** Extra classes for the <input>. */
  inputClassName?: string;
};

export function TextField({ id, label, hint, error, labelAside, trailing, children, className, inputClassName = "", ref, "aria-describedby": describedBy, "aria-invalid": ariaInvalid, ...input }: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const hasError = Boolean(error);
  // Read in the order they appear: the problem first, then the hint, then anything the form adds (a checklist).
  const descriptions = [hasError ? errorId : "", hint ? hintId : "", describedBy ?? ""].filter(Boolean).join(" ");

  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={fieldId} className="text-sm font-bold leading-5">{label}</label>
        {labelAside}
      </div>
      <div className="relative">
        <input
          {...input}
          ref={ref}
          id={fieldId}
          aria-invalid={hasError ? true : ariaInvalid}
          aria-describedby={descriptions || undefined}
          className={`pk-input transition-[border-color,box-shadow] duration-150 read-only:bg-packam-grey-50 disabled:cursor-not-allowed disabled:text-black/50 aria-[invalid=true]:border-packam-error aria-[invalid=true]:focus:border-packam-black ${inputClassName}`}
        />
        {trailing}
      </div>
      {hasError && (
        <p id={errorId} className="mt-2 flex items-start gap-1.5 text-sm font-semibold leading-5 text-packam-error">
          <Icon name="alert" className="mt-px h-4 w-4" strokeWidth={2.1} />
          <span>{error}</span>
        </p>
      )}
      {hint && <p id={hintId} className="mt-1.5 text-[0.8125rem] leading-5 text-black/60">{hint}</p>}
      {children}
    </div>
  );
}
