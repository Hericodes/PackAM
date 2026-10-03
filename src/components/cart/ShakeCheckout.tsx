"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type MotionWithPermission = typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> };

export function ShakeCheckout() {
  const [mobile, setMobile] = useState(false);
  const [supported, setSupported] = useState(false);
  const [armed, setArmed] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const cooldown = useRef(0);

  useEffect(() => {
    const isMobile = window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(max-width: 900px)").matches;
    const frame = window.requestAnimationFrame(() => {
      setMobile(isMobile);
      setSupported(isMobile && "DeviceMotionEvent" in window);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function enable() {
    setMessage("");
    try {
      const motion = window.DeviceMotionEvent as MotionWithPermission;
      if (motion.requestPermission) {
        const permission = await motion.requestPermission();
        if (permission !== "granted") { setMessage("Motion permission is needed to use shake checkout."); return; }
      }
      setArmed(true);
    } catch { setMessage("Shake checkout isn’t available right now. You can still use Go to Checkout."); }
  }

  useEffect(() => {
    if (!armed || !supported || confirm) return;
    function onMotion(event: DeviceMotionEvent) {
      const acceleration = event.acceleration ?? event.accelerationIncludingGravity;
      const x = acceleration?.x ?? 0;
      const y = acceleration?.y ?? 0;
      const z = acceleration?.z ?? 0;
      if (Math.sqrt(x * x + y * y + z * z) < 20 || Date.now() < cooldown.current) return;
      cooldown.current = Date.now() + 1800;
      setConfirm(true);
      setArmed(false);
    }
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [armed, supported, confirm]);

  if (!mobile || !supported) return null;
  return <div className="fixed bottom-20 right-4 z-40 max-w-[calc(100vw-2rem)] rounded-2xl bg-[#fff8df] p-3 text-center shadow-lg sm:right-7">
    {confirm ? <><p className="font-black">You dey ready? 😆</p><div className="mt-3 flex justify-center gap-3"><Link href="/checkout" className="rounded-full bg-black px-5 py-2.5 text-sm font-black text-white">Go to Checkout</Link><button type="button" onClick={() => { setConfirm(false); setMessage(""); }} className="rounded-full border border-black/15 px-5 py-2.5 text-sm font-bold">Keep shopping</button></div></> : <><p className="text-sm font-bold">Optional shortcut: shake your phone to check out.</p><button type="button" onClick={enable} disabled={armed} className="mt-3 rounded-full border border-black/15 px-4 py-2 text-sm font-bold disabled:opacity-50">{armed ? "Shake to checkout is on" : "Enable shake checkout"}</button>{message && <p role="status" className="mt-2 text-xs text-black/60">{message}</p>}</>}
  </div>;
}
