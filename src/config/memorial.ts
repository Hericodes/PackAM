/**
 * The memorial page (/in-memory) for one of our students, who passed away on 10 November 2026. From `startsAt` until
 * `endsAt` (campus time), students land on it straight after they sign in, and students who are already signed in see
 * it once per browser the first time they open PackAM. Runners and admins go straight to work. After `endsAt` nobody
 * is sent there; the page itself stays up for anyone with the link. No orders on 11 November: see
 * src/config/ordering-closures.ts. Pure, so it is safe in the browser.
 */
export const MEMORIAL = {
  /** Names the "already seen" flag in each browser. */
  id: "2026-11-10",
  startsAt: Date.parse("2026-11-10T00:00:00+01:00"),
  /** The end of Wednesday 11 November. */
  endsAt: Date.parse("2026-11-12T00:00:00+01:00"),
} as const;

export const MEMORIAL_PATH = "/in-memory";

export function memorialActive(now: number = Date.now()) {
  return now >= MEMORIAL.startsAt && now < MEMORIAL.endsAt;
}

/** The memorial page, then on to `next` (an internal path already checked for the student). */
export function memorialHref(next: string) {
  return next && next !== "/" ? `${MEMORIAL_PATH}?${new URLSearchParams({ next })}` : MEMORIAL_PATH;
}

/** The browser flag that stops an already signed-in student being sent to the page twice. */
export const MEMORIAL_SEEN_KEY = `packam:memorial-seen:${MEMORIAL.id}`;
