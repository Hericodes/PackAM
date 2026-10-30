"use client";

import { useEffect, useRef, useState } from "react";
import { PackAMLogo } from "../brand/PackAMLogo";
import { Icon } from "../ui/Icon";
import type { IosInstallRoute } from "../../lib/pwa/install-policy";

/**
 * The install suggestion: a card at the bottom of the screen that never blocks the page. "Install PackAM"
 * opens the browser's own install prompt (or the iPhone/iPad guide); "Maybe later" rests it for a while.
 */
export function InstallPrompt({ onInstall, onDismiss, ios }: { onInstall: () => void; onDismiss: () => void; ios: boolean }) {
  const [onPhone] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  return (
    <section
      aria-labelledby="install-prompt-title"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-[24px] border border-black/10 bg-white p-4 shadow-[0_14px_40px_rgba(8,8,8,0.16)] sm:inset-x-auto sm:right-7 sm:bottom-7 sm:w-[380px] sm:p-5"
    >
      <button type="button" onClick={onDismiss} aria-label="Close" className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-black/50 transition hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-black">
        <Icon name="close" className="h-[18px] w-[18px]" />
      </button>
      <div className="flex items-center gap-3 pr-8">
        <div className="min-w-0 flex-1">
          <h2 id="install-prompt-title" className="text-lg font-black leading-tight">{onPhone ? "Get PackAM on your phone" : "Get the PackAM app"}</h2>
          <p className="mt-1.5 text-sm leading-5 text-black/65">
            {onPhone ? "Open PackAM straight from your home screen, for quicker ordering, printing and order tracking." : "Open PackAM in its own window, for quicker ordering, printing and order tracking."}
          </p>
        </div>
        <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl bg-[#fffdf7] ring-1 ring-black/5">
          <PackAMLogo width={60} />
        </div>
      </div>
      <button type="button" onClick={onInstall} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
        {ios ? "Show me how" : "Install PackAM"}
      </button>
      <button type="button" onClick={onDismiss} className="mx-auto mt-1.5 flex min-h-10 items-center px-3 text-sm font-semibold text-black/55 transition hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-black">
        Maybe later
      </button>
    </section>
  );
}

type Step = { icon: "check" | "share" | "plusSquare" | "smartphone"; title: string; detail: string; done?: boolean };

function stepsFor(route: Exclude<IosInstallRoute, null>): Step[] {
  const share: Step = route === "ios-browser"
    ? { icon: "share", title: "Tap the Share button", detail: "It’s in the address bar or the menu (⋯) of your browser." }
    : { icon: "share", title: "Tap the Share button", detail: "The square with an arrow pointing up, at the bottom of the screen on iPhone or the top on iPad." };
  return [
    route === "ios-open-in-safari"
      ? { icon: "smartphone", title: "Open PackAM in Safari", detail: "This app can’t add PackAM to your home screen. Use its menu to open the page in Safari, or copy the link below and paste it into Safari." }
      : { icon: "check", title: route === "ios-safari" ? "Open PackAM in Safari" : "Open PackAM in your browser", detail: "You’re already here.", done: true },
    share,
    { icon: "plusSquare", title: "Choose “Add to Home Screen”", detail: "Scroll down the list if you don’t see it straight away." },
    { icon: "check", title: "Tap “Add” to confirm", detail: "PackAM appears on your home screen. Open it from there." },
  ];
}

/** Step-by-step Add to Home Screen for iPhone and iPad, where browsers don't offer an install prompt. */
export function IosInstallGuide({ route, onClose }: { route: Exclude<IosInstallRoute, null>; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [onClose]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
    } catch { /* clipboard blocked: the address is shown on screen to copy by hand */ }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="ios-install-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[24px] bg-white p-5 shadow-[0_14px_40px_rgba(8,8,8,0.2)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="pk-eyebrow">iPhone &amp; iPad</p>
            <h2 id="ios-install-title" className="mt-1 text-xl font-black leading-tight">Add PackAM to your home screen</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-black/55 transition hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-black">
            <Icon name="close" className="h-[18px] w-[18px]" />
          </button>
        </div>
        <ol className="mt-4 space-y-3">
          {stepsFor(route).map((step, index) => (
            <li key={step.title} className="flex gap-3 rounded-2xl bg-[#fafafa] p-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${step.done ? "bg-[#e9f8ee] text-[#16803c]" : "bg-[#feb80a] text-black"}`} aria-hidden="true">
                {step.done ? <Icon name="check" className="h-[18px] w-[18px]" /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-black">
                  {step.title}
                  {!step.done && step.icon !== "check" && <Icon name={step.icon} className="h-[18px] w-[18px] text-black/70" />}
                </p>
                <p className="mt-0.5 text-sm leading-5 text-black/65">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        {route === "ios-open-in-safari" && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-black/10 p-2 pl-3">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{typeof window === "undefined" ? "" : window.location.host}</span>
            <button type="button" onClick={() => void copyLink()} className="min-h-10 shrink-0 rounded-full bg-black px-4 text-sm font-black text-white">{copied ? "Copied" : "Copy link"}</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full border border-black/15 bg-white px-5 text-sm font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
          Got it
        </button>
      </div>
    </div>
  );
}

/** "Installing…" after the browser's prompt is accepted; "installed" only once the browser confirms it. */
export function InstallStatus({ status, onDone }: { status: "idle" | "installing" | "installed"; onDone: () => void }) {
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(onDone, status === "installed" ? 6000 : 20000);
    return () => window.clearTimeout(timer);
  }, [status, onDone]);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-[60] mx-auto max-w-sm">
      {status !== "idle" && (
        <p className="rounded-2xl bg-black px-4 py-3 text-center text-sm font-bold text-white shadow-lg">
          {status === "installing" ? "Installing PackAM…" : "PackAM is installed. Open it from your home screen or apps."}
        </p>
      )}
    </div>
  );
}
