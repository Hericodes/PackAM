"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useCartExperience } from "../cart/CartExperience";
import { InstallPrompt, IosInstallGuide, InstallStatus } from "./InstallPrompt";
import {
  EMPTY_INSTALL_STATE,
  MIN_TIME_ON_SITE_MS,
  iosInstallRoute,
  parseInstallState,
  recordDismissal,
  recordPageView,
  shouldAutoPrompt,
  type InstallState,
  type IosInstallRoute,
} from "../../lib/pwa/install-policy";

/** Chromium's install event (Android Chrome, Samsung Internet, desktop Chrome and Edge). Not in the DOM types. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type Status = "idle" | "installing" | "installed";

type PwaContextValue = {
  /** Installing is possible right now: the browser offered its prompt, or this is iPhone/iPad. */
  canInstall: boolean;
  /** Opened from the home screen or as an installed app. */
  standalone: boolean;
  /** Shows the browser's install prompt, or the iPhone/iPad guide. */
  install: () => Promise<void>;
};

const PwaContext = createContext<PwaContextValue>({ canInstall: false, standalone: false, install: async () => {} });
const STORAGE_KEY = "packam:install";

function readState(): InstallState {
  try { return parseInstallState(window.localStorage.getItem(STORAGE_KEY)); } catch { return EMPTY_INSTALL_STATE; }
}
function writeState(state: InstallState) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode: the prompt simply rests for this visit */ }
}

function isStandalone() {
  return ["standalone", "fullscreen", "minimal-ui"].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { count: cartCount } = useCartExperience();
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [iosRoute, setIosRoute] = useState<IosInstallRoute>(null);
  const [standalone, setStandalone] = useState(false);
  const [state, setState] = useState<InstallState>(EMPTY_INSTALL_STATE);
  const [ready, setReady] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [now, setNow] = useState(0);
  // Shown by itself at most once per visit, even if the visitor just carries on browsing.
  const shownThisVisit = useRef(false);

  const update = useCallback((change: (current: InstallState) => InstallState) => {
    setState((current) => { const next = change(current); writeState(next); return next; });
  }, []);

  // Service worker: production only, so development builds never serve cached files.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () => { navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => { /* the site works the same without it */ }); };
    if (document.readyState === "complete") register();
    else { window.addEventListener("load", register, { once: true }); return () => window.removeEventListener("load", register); }
  }, []);

  // What this browser supports, and the browser's own install events.
  useEffect(() => {
    const stored = readState();
    const timer = window.setTimeout(() => {
      setState(stored);
      setStandalone(isStandalone());
      setIosRoute(iosInstallRoute(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
      setNow(Date.now());
      setReady(true);
    }, 0);
    const onBeforeInstall = (event: Event) => {
      // We show our own prompt at a better moment instead of the browser's banner.
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      setNativeAvailable(true);
    };
    const onInstalled = () => {
      deferred.current = null;
      setNativeAvailable(false);
      setPromptOpen(false);
      setStatus("installed");
      update((current) => ({ ...current, installed: true }));
    };
    const media = window.matchMedia("(display-mode: standalone)");
    const onDisplayChange = () => setStandalone(isStandalone());
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    media.addEventListener("change", onDisplayChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      media.removeEventListener("change", onDisplayChange);
    };
  }, [update]);

  // Count page views, and look again once the visitor has been around for a while.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => { update((current) => recordPageView(current, Date.now())); setNow(Date.now()); }, 0);
    const later = window.setTimeout(() => setNow(Date.now()), MIN_TIME_ON_SITE_MS + 1000);
    return () => { window.clearTimeout(timer); window.clearTimeout(later); };
  }, [pathname, ready, update]);

  // Only Safari (and iOS 16.4+ browsers with Add to Home Screen) are prompted on iPhone; in-app browsers get the guide from the menu.
  const iosCanPrompt = iosRoute === "ios-safari" || iosRoute === "ios-browser";
  const canInstall = !standalone && (nativeAvailable || iosRoute !== null);

  useEffect(() => {
    if (!ready || promptOpen || guideOpen || shownThisVisit.current) return;
    const show = shouldAutoPrompt(state, { now, path: pathname, canInstall: nativeAvailable || iosCanPrompt, standalone, cartCount });
    if (!show) return;
    const timer = window.setTimeout(() => { shownThisVisit.current = true; setPromptOpen(true); }, 1500);
    return () => window.clearTimeout(timer);
  }, [ready, promptOpen, guideOpen, state, now, pathname, nativeAvailable, iosCanPrompt, standalone, cartCount]);

  // Leaving a browsing page (e.g. to checkout) closes the prompt without counting it as "Maybe later".
  useEffect(() => {
    const timer = window.setTimeout(() => setPromptOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  const install = useCallback(async () => {
    setPromptOpen(false);
    const event = deferred.current;
    if (event) {
      // The browser's prompt can be used once; afterwards wait for it to offer again.
      deferred.current = null;
      setNativeAvailable(false);
      try {
        await event.prompt();
        const choice = await event.userChoice;
        if (choice.outcome === "accepted") setStatus("installing"); // "installed" only once the browser says so (appinstalled)
        else update((current) => recordDismissal(current, Date.now()));
      } catch { /* the browser refused to show it; nothing changed */ }
      return;
    }
    if (iosRoute) setGuideOpen(true);
  }, [iosRoute, update]);

  const dismiss = useCallback(() => {
    setPromptOpen(false);
    update((current) => recordDismissal(current, Date.now()));
  }, [update]);

  const closeGuide = useCallback(() => setGuideOpen(false), []);
  const clearStatus = useCallback(() => setStatus("idle"), []);

  const value = useMemo(() => ({ canInstall, standalone, install }), [canInstall, standalone, install]);

  return (
    <PwaContext.Provider value={value}>
      {children}
      {promptOpen && canInstall && <InstallPrompt onInstall={() => void install()} onDismiss={dismiss} ios={!nativeAvailable && iosRoute !== null} />}
      {guideOpen && iosRoute && <IosInstallGuide route={iosRoute} onClose={closeGuide} />}
      <InstallStatus status={status} onDone={clearStatus} />
    </PwaContext.Provider>
  );
}

export function usePwa() {
  return useContext(PwaContext);
}
