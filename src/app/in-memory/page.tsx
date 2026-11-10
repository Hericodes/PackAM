import type { Metadata } from "next";
import Link from "next/link";
import { PackAMLogo } from "../../components/brand/PackAMLogo";
import { MemorialSeen } from "../../components/memorial/MemorialSeen";
import { resolvePostLoginDestination } from "../../lib/auth-redirect";
import { formatCampusClock, orderingHoursFromEnv } from "../../lib/ordering-hours";

export const metadata: Metadata = { title: "In loving memory", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/**
 * In memory of one of our students, who passed away on 10 November 2026 (see src/config/memorial.ts for who is sent
 * here and until when). No name, as the PackAM team chose. "Continue" goes on to where the student was headed:
 * `next`, checked like any post-login destination, else home.
 */
export default async function InMemoryPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const destination = resolvePostLoginDestination("STUDENT", typeof next === "string" ? next : null);
  const opensAt = formatCampusClock(orderingHoursFromEnv().opensAtMinute);

  return (
    <main className="min-h-screen bg-[#f4f2ed] px-4 py-10">
      <MemorialSeen />
      <div className="mx-auto flex min-h-[85svh] max-w-lg flex-col justify-center">
        <Link href={destination} aria-label="PackAM home" className="mb-8 self-center opacity-70 transition hover:opacity-100"><PackAMLogo width={76} /></Link>

        <article aria-labelledby="memorial-title" className="rounded-3xl border border-black/10 bg-white px-6 py-9 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:px-10">
          <Candle />
          <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-black/45">In loving memory</p>
          <h1 id="memorial-title" className="mt-3 text-[1.7rem] font-black leading-tight tracking-tight sm:text-3xl">Forever one of us</h1>
          <p className="mx-auto mt-4 max-w-sm text-base leading-7 text-black/75">
            With heavy hearts, we share that the PackAM family has lost one of our own, a student of Olabisi Onabanjo University.
          </p>
          <p className="mx-auto mt-3 max-w-sm text-base leading-7 text-black/75">
            Our deepest condolences go to his family, his friends, his coursemates and everyone who knew and loved him.
          </p>

          <div className="mx-auto mt-7 max-w-sm rounded-2xl bg-[#f4f2ed] px-5 py-4 text-left">
            <p className="text-sm font-black">No orders on Wednesday, 11 November</p>
            <p className="mt-1 text-sm leading-6 text-black/70">Out of respect for him, PackAM is closed for the day. We’ll be back on Thursday, 12 November, from {opensAt}.</p>
          </div>

          <p className="mx-auto mt-6 max-w-sm text-sm leading-6 text-black/60">
            If this news has hit you hard, please don’t carry it alone. Talk to a friend, a family member or someone you trust.
          </p>
          <p className="mt-6 text-base font-semibold italic text-black/80">May his gentle soul rest in perfect peace.</p>

          <Link href={destination} className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-black px-7 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
            Continue to PackAM
          </Link>
        </article>
      </div>
    </main>
  );
}

/** A lit candle: still for anyone who prefers reduced motion, a gentle glow for everyone else. */
function Candle() {
  return (
    <svg viewBox="0 0 64 96" width="56" height="84" aria-hidden="true" className="mx-auto">
      <ellipse cx="32" cy="22" rx="14" ry="18" fill="#f6d77a" className="opacity-40 motion-safe:animate-pulse" />
      <path d="M32 6c5 8 8 13 8 18a8 8 0 0 1-16 0c0-5 3-10 8-18z" fill="#f2b93b" />
      <path d="M32 15c2.5 4 4 6.5 4 9a4 4 0 0 1-8 0c0-2.5 1.5-5 4-9z" fill="#fff4cf" />
      <rect x="31" y="31" width="2" height="6" rx="1" fill="#3a3a3a" />
      <rect x="20" y="37" width="24" height="52" rx="4" fill="#fbfaf7" stroke="#d9d5cc" strokeWidth="1.5" />
      <path d="M20 45c4 3 8 3 12 0s8-3 12 0" fill="none" stroke="#e7e3da" strokeWidth="1.5" />
    </svg>
  );
}
