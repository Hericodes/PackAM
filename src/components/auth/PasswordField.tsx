"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Icon } from "../ui/Icon";
import { TextField, type TextFieldProps } from "./TextField";

/**
 * A TextField for passwords with a show/hide toggle and a Caps Lock warning. The value is whatever the person
 * types (no trimming or limits here: existing passwords are used exactly as typed). Pass autoComplete
 * ("current-password" or "new-password"); to show a PasswordChecklist, render it as a child and point
 * aria-describedby at its id.
 *
 * It never renders a name attribute: the auth forms have no method or action, so a submit before the page
 * has loaded is a GET to the same URL, and a named password field would put the password in that URL.
 */
export type PasswordFieldProps = Omit<TextFieldProps, "type" | "name" | "trailing">;

export function PasswordField({ id, disabled, inputClassName = "", children, onKeyDown, onKeyUp, onBlur, ...field }: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const toggleLabel = visible ? "Hide password" : "Show password";

  function toggle() {
    const input = document.getElementById(inputId);
    // A mouse or touch toggle never takes focus (see onMouseDown), so the person may be mid-word: keep the caret.
    const caret = input instanceof HTMLInputElement && input === document.activeElement
      ? { input, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection }
      : null;
    // Switching type keeps the value but can move the caret, so put it back once the new type is on the page.
    flushSync(() => setVisible((shown) => !shown));
    if (caret && caret.start !== null && caret.end !== null) caret.input.setSelectionRange(caret.start, caret.end, caret.direction ?? undefined);
  }

  // Only physical keyboards report Caps Lock, so phones never show the warning.
  function readCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState("CapsLock"));
  }

  return (
    <TextField
      {...field}
      id={inputId}
      name={undefined}
      type={visible ? "text" : "password"}
      disabled={disabled}
      // Shown as text, a password must not be autocorrected or capitalised by the phone's keyboard.
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      onKeyDown={(event) => { readCapsLock(event); onKeyDown?.(event); }}
      onKeyUp={(event) => { readCapsLock(event); onKeyUp?.(event); }}
      onBlur={(event) => { setCapsLock(false); onBlur?.(event); }}
      // Room for the toggle, and no second eye from Edge's built-in reveal button.
      inputClassName={`pr-12 [&::-ms-reveal]:hidden ${inputClassName}`}
      trailing={
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggle}
          disabled={disabled}
          aria-label={toggleLabel}
          aria-pressed={visible}
          aria-controls={inputId}
          data-tip={toggleLabel}
          className="pk-tip absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-black/60 transition-colors hover:bg-black/5 hover:text-black focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          <Icon name={visible ? "eyeOff" : "eye"} className="h-5 w-5" />
        </button>
      }
    >
      <div role="status">
        {capsLock && (
          <p className="mt-2">
            <span className="pk-pill pk-pill-warning"><Icon name="alert" className="h-3.5 w-3.5" strokeWidth={2.2} />Caps Lock is on</span>
          </p>
        )}
      </div>
      {children}
    </TextField>
  );
}
