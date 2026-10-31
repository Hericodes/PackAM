"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { PARCEL_DROP_POINT, gripOrigin, logoPointInPage, logoWithoutParcelMask, parcelClipPath } from "./parcel-geometry";

/**
 * "Packed": the success moment after the server has confirmed a sign-in or sign-up. The form's fields and
 * button lift off the page and drop into the parcel the PackAM character is holding, with a few brand-coloured
 * bits; the parcel takes the delivery with a little bounce and a shine, and PackAM opens.
 *
 * Decorative only. It runs after authentication has already succeeded, never decides anything, and always
 * ends in onFinish(): straight away when animations aren't available or something throws, after a short calm
 * moment for reduced motion, and from a safety timer whatever happens.
 */

export type PackSource = { left: number; top: number; width: number; height: number; kind: "field" | "button" };

const TOTAL_MS = 1150;
const SAFETY_MS = 2600;
const REDUCED_MS = 420;
const LOGO_PARCEL_MASK = logoWithoutParcelMask();
const PARCEL_CLIP = parcelClipPath();
const GRIP = gripOrigin();

/** Brand bits that fly in with the form: yellow, ink, the cap's red, cardboard, butter. */
const BITS = [
  { color: "#feb80a", w: 12, h: 12, r: 3 }, { color: "#080808", w: 8, h: 8, r: 999 }, { color: "#e4a560", w: 16, h: 6, r: 3 },
  { color: "#f04438", w: 9, h: 9, r: 999 }, { color: "#feb80a", w: 8, h: 8, r: 999 }, { color: "#fff4c7", w: 12, h: 12, r: 3 },
  { color: "#080808", w: 14, h: 5, r: 3 }, { color: "#feb80a", w: 10, h: 10, r: 3 }, { color: "#e4a560", w: 9, h: 9, r: 2 },
  { color: "#f04438", w: 12, h: 5, r: 3 },
] as const;

function prefersReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export function AuthSuccess({ greeting, sources, logoFrom, onFinish }: { greeting: string; sources: PackSource[]; logoFrom?: PackSource | null; onFinish: () => void }) {
  const finished = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLImageElement>(null);
  const parcelRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const flyerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [reduced] = useState(() => (typeof window === "undefined" ? false : prefersReducedMotion()));

  // Bits start around the form, spread on a loose ring; deterministic so it looks designed, not random.
  const area = sources.length
    ? sources.reduce((box, s) => ({ left: Math.min(box.left, s.left), top: Math.min(box.top, s.top), right: Math.max(box.right, s.left + s.width), bottom: Math.max(box.bottom, s.top + s.height) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
    : null;
  const bits = area ? BITS.map((bit, i) => {
    const angle = (i / BITS.length) * Math.PI * 2 + 0.4;
    const cx = (area.left + area.right) / 2; const cy = (area.top + area.bottom) / 2;
    const rx = (area.right - area.left) / 2 + 18; const ry = (area.bottom - area.top) / 2 + 14;
    return { ...bit, x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  }) : [];

  // Props are captured once by the caller (the moment sign-in succeeded), so this runs once; in development
  // React runs it twice, and the first, cancelled run never navigates.
  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (cancelled || finished.current) return;
      finished.current = true;
      try { onFinish(); } catch { /* navigation is the caller's; nothing to undo here */ }
    };
    const safety = window.setTimeout(finish, SAFETY_MS);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    async function run() {
      const overlay = overlayRef.current; const logo = logoRef.current;
      if (!overlay || !logo || typeof overlay.animate !== "function") { finish(); return; }
      if (reduced) {
        overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: "both" });
        window.setTimeout(finish, REDUCED_MS);
        return;
      }
      const ease = "cubic-bezier(.2,.8,.2,1)";
      overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out", fill: "both" });

      // The logo glides from where it sat on the page to the centre (or settles in, if it wasn't on screen).
      const final = logo.getBoundingClientRect();
      if (logoFrom && logoFrom.width > 0) {
        const dx = logoFrom.left + logoFrom.width / 2 - (final.left + final.width / 2);
        const dy = logoFrom.top + logoFrom.height / 2 - (final.top + final.height / 2);
        const s = logoFrom.width / final.width;
        logo.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: "none" }], { duration: 460, easing: ease, fill: "both" });
      } else {
        logo.animate([{ opacity: 0, transform: "scale(.88)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: ease, fill: "both" });
      }
      textRef.current?.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: 380, easing: ease, fill: "both" });

      // Everything drops into the parcel's top face.
      const target = logoPointInPage(final, PARCEL_DROP_POINT);
      const flights = flyerRefs.current.map((el, i) => {
        if (!el) return null;
        const box = el.getBoundingClientRect();
        const dx = target.x - (box.left + box.width / 2);
        const dy = target.y - (box.top + box.height / 2);
        const isSource = i < sources.length;
        const lift = Math.min(140, Math.abs(dx) * 0.35 + 60);
        const delay = isSource ? 140 + i * 60 : 90 + (i - sources.length) * 34;
        const spin = isSource ? (i % 2 ? 6 : -6) : (i % 2 ? 160 : -140);
        return el.animate([
          { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1, offset: 0 },
          { transform: `translate(${dx * 0.42}px, ${dy * 0.42 - lift}px) scale(${isSource ? 0.42 : 0.9}) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.48 },
          { transform: `translate(${dx}px, ${dy - 10}px) scale(${isSource ? 0.08 : 0.5}) rotate(${spin}deg)`, opacity: 1, offset: 0.9 },
          { transform: `translate(${dx}px, ${dy + 4}px) scale(0.02) rotate(${spin}deg)`, opacity: 0, offset: 1 },
        ], { duration: isSource ? 560 : 520, delay, easing: "cubic-bezier(.45,0,.25,1)", fill: "both" }).finished;
      }).filter(Boolean);

      // The parcel takes the delivery: the plain logo underneath loses its parcel so the moving one never doubles up.
      const popAt = 780;
      await new Promise((resolve) => window.setTimeout(resolve, popAt));
      const base = baseRef.current; const parcel = parcelRef.current;
      if (base && parcel) {
        base.style.setProperty("mask-image", LOGO_PARCEL_MASK);
        base.style.setProperty("-webkit-mask-image", LOGO_PARCEL_MASK);
        parcel.style.visibility = "visible";
        const pop = parcel.animate([
          { transform: "none" },
          { transform: "rotate(-8deg) scale(1.1)", offset: 0.3 },
          { transform: "rotate(4deg) scale(1.02)", offset: 0.62 },
          { transform: "rotate(-1.5deg) scale(1.01)", offset: 0.82 },
          { transform: "none" },
        ], { duration: 420, easing: "ease-out", fill: "both" });
        shineRef.current?.animate([{ transform: "translateX(-140%) skewX(-18deg)", opacity: 0 }, { opacity: 0.85, offset: 0.4 }, { transform: "translateX(240%) skewX(-18deg)", opacity: 0 }], { duration: 360, delay: 140, easing: "ease-in-out", fill: "both" });
        void pop.finished.then(() => {
          // Back to the untouched logo.
          base.style.removeProperty("mask-image");
          base.style.removeProperty("-webkit-mask-image");
          parcel.style.visibility = "hidden";
        }).catch(() => undefined);
      }
      await Promise.race([Promise.allSettled(flights), new Promise((resolve) => window.setTimeout(resolve, TOTAL_MS - popAt))]);
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, TOTAL_MS - popAt - 260)));
      finish();
    }

    void run().catch(finish);
    return () => {
      cancelled = true;
      window.clearTimeout(safety);
      document.body.style.overflow = previousOverflow;
    };
  }, [logoFrom, onFinish, reduced, sources]);

  const logoSize = "min(260px, 58vw)";
  return (
    <div ref={overlayRef} className="fixed inset-0 z-100 overflow-hidden bg-[#fffdf7]" style={{ opacity: 0 }}>
      {/* Brand warmth behind the logo; no glow, no gradient sweep. */}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: "radial-gradient(38rem 28rem at 50% 38%, rgba(254,184,10,0.16), rgba(254,184,10,0) 70%)" }} />

      {/* Ghosts of the form's fields and button, starting exactly where they were. */}
      {!reduced && sources.map((source, i) => (
        <div
          key={`s${i}`}
          ref={(el) => { flyerRefs.current[i] = el; }}
          aria-hidden="true"
          className={`absolute ${source.kind === "button" ? "bg-black" : "border border-black/15 bg-white"}`}
          style={{ left: source.left, top: source.top, width: source.width, height: source.height, borderRadius: 16 }}
        />
      ))}
      {!reduced && bits.map((bit, i) => (
        <div
          key={`b${i}`}
          ref={(el) => { flyerRefs.current[sources.length + i] = el; }}
          aria-hidden="true"
          className="absolute"
          style={{ left: bit.x - bit.w / 2, top: bit.y - bit.h / 2, width: bit.w, height: bit.h, borderRadius: bit.r, background: bit.color, boxShadow: bit.color === "#fff4c7" ? "inset 0 0 0 1.5px rgba(8,8,8,0.25)" : undefined }}
        />
      ))}

      <div className="absolute inset-x-0 top-[42%] flex -translate-y-1/2 flex-col items-center px-6">
        <div ref={logoRef} className="relative" style={{ width: logoSize, aspectRatio: "1 / 1" }}>
          <Image ref={baseRef} src="/packam-logo.png" alt="PackAM" width={500} height={500} priority unoptimized className="absolute inset-0 h-full w-full select-none" style={{ maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }} draggable={false} />
          {/* The parcel on its own layer, pivoting on the hand that holds it. Hidden except while it moves. */}
          <div ref={parcelRef} aria-hidden="true" className="absolute inset-0 overflow-hidden" style={{ clipPath: PARCEL_CLIP, transformOrigin: GRIP, visibility: "hidden" }}>
            <Image src="/packam-logo.png" alt="" width={500} height={500} unoptimized className="h-full w-full select-none" draggable={false} />
            <span ref={shineRef} className="absolute inset-y-0 left-0 w-1/3" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.7), rgba(255,255,255,0))", opacity: 0 }} />
          </div>
        </div>
        <div ref={textRef} role="status" aria-live="polite" className="mt-2 text-center" style={{ opacity: reduced ? 1 : 0 }}>
          <p className="text-2xl font-black tracking-tight sm:text-3xl">{greeting}</p>
          <p className="mt-1 text-sm font-semibold text-black/55">Opening PackAM…</p>
        </div>
      </div>
    </div>
  );
}
