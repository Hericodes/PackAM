"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type MotionWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

const informationKey = "packam-shake-checkout-info-seen";
let informationSeenInMemory = false;

function hasSeenInformation() {
  if (informationSeenInMemory) return true;

  try {
    informationSeenInMemory =
      window.localStorage.getItem(informationKey) === "1";

    return informationSeenInMemory;
  } catch {
    try {
      informationSeenInMemory =
        window.sessionStorage.getItem(informationKey) === "1";

      return informationSeenInMemory;
    } catch {
      return false;
    }
  }
}

function rememberInformation() {
  informationSeenInMemory = true;

  try {
    window.localStorage.setItem(informationKey, "1");
  } catch {
    try {
      window.sessionStorage.setItem(informationKey, "1");
    } catch {
      // The information remains dismissed for this mounted instance.
    }
  }
}

export function ShakeCheckout() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [showInformation, setShowInformation] = useState(false);
  const [isArmed, setIsArmed] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const cooldownUntil = useRef(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const isMobile =
        window.matchMedia("(pointer: coarse)").matches &&
        window.matchMedia("(max-width: 900px)").matches;

      const hasMotion = "DeviceMotionEvent" in window;

      if (!isMobile || !hasMotion) return;

      const alreadySeen = hasSeenInformation();

      setIsAvailable(true);
      setShowInformation(!alreadySeen);
      setIsArmed(alreadySeen);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function acknowledgeInformation() {
    rememberInformation();
    setShowInformation(false);

    try {
      const motion = window.DeviceMotionEvent as MotionWithPermission;

      if (motion.requestPermission) {
        const permission = await motion.requestPermission();

        if (permission !== "granted") {
          setIsAvailable(false);
          return;
        }
      }

      setIsArmed(true);
    } catch {
      setIsArmed(false);
      setIsAvailable(false);
    }
  }

  useEffect(() => {
    if (!isArmed || !isAvailable || showConfirmation) return;

    function onMotion(event: DeviceMotionEvent) {
      const acceleration = event.acceleration;
      const withGravity = event.accelerationIncludingGravity;

      const magnitude = acceleration
        ? Math.hypot(
            acceleration.x ?? 0,
            acceleration.y ?? 0,
            acceleration.z ?? 0,
          )
        : withGravity
          ? Math.abs(
              Math.hypot(
                withGravity.x ?? 0,
                withGravity.y ?? 0,
                withGravity.z ?? 0,
              ) - 9.81,
            )
          : 0;

      if (magnitude < 14 || Date.now() < cooldownUntil.current) return;

      cooldownUntil.current = Date.now() + 1800;

      setShowConfirmation(true);
      setIsArmed(false);
    }

    window.addEventListener("devicemotion", onMotion);

    return () => window.removeEventListener("devicemotion", onMotion);
  }, [isArmed, isAvailable, showConfirmation]);

  useEffect(() => {
    if (!showConfirmation) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowConfirmation(false);
        setIsArmed(true);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showConfirmation]);

  if (!isAvailable || (!showInformation && !showConfirmation)) {
    return null;
  }

  return (
    <aside
      aria-live="polite"
      className="fixed bottom-20 right-4 z-40 max-w-[calc(100vw-2rem)] rounded-2xl border border-black/10 bg-[#fffdf7] p-4 shadow-lg sm:right-7"
    >
      {showInformation ? (
        <>
          <p className="font-bold">Shake to checkout? 👀</p>

          <p className="mt-1 max-w-xs text-sm leading-5 text-black/70">
            Got stuff in your cart? Give your phone a little shake and we’ll
            take you straight to checkout.
          </p>

          <button
            type="button"
            onClick={() => void acknowledgeInformation()}
            className="mt-3 min-h-11 rounded-xl bg-[#feb80a] px-4 text-sm font-bold text-black transition hover:bg-[#e5a500] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Got it 👍
          </button>
        </>
      ) : showConfirmation ? (
        <>
          <p className="font-bold">Checkout time? 👀</p>

          <p className="mt-1 text-sm text-black/70">
            Your cart is ready when you are.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/checkout"
              className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-xl bg-black px-4 text-sm font-bold text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto"
            >
              Go to Checkout
            </Link>

            <button
              type="button"
              onClick={() => {
                setShowConfirmation(false);
                setIsArmed(true);
              }}
              className="min-h-11 w-full rounded-xl border border-black/15 bg-white px-4 text-sm font-semibold text-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto"
            >
              Keep shopping
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}