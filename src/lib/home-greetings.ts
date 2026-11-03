/**
 * The homepage headline and its line underneath, in Pidgin. One is picked for each visit (each page load), so a
 * returning student sees a different one. "Wetin dey sup?" stays first: it's PackAM's signature line.
 */
export const HOME_GREETINGS = [
  { title: "Wetin dey sup?", subtitle: "Pick wetin you need — we go handle the waka." },
  { title: "How far, wetin you need?", subtitle: "Just talk am — we go bring am come meet you." },
  { title: "Oya, make we run am for you!", subtitle: "Food, provisions or printing — pick one, we go do the rest." },
  { title: "No shaking, we dey for you.", subtitle: "Choose wetin you want, relax — we dey come sharp sharp." },
  { title: "Wetin you wan collect today?", subtitle: "From food to prints, e go reach you for campus." },
] as const;

export type HomeGreeting = (typeof HOME_GREETINGS)[number];

/** Remembers which greeting this browser saw last (an index, nothing personal), so the next visit shows another. */
export const GREETING_COOKIE = "pk_greeting";

/** The index stored in the cookie, or null when it's missing or not one of ours. */
export function parseGreetingIndex(value: string | undefined): number | null {
  if (!value || !/^\d$/.test(value)) return null;
  const index = Number(value);
  return index < HOME_GREETINGS.length ? index : null;
}

/**
 * A greeting for this visit, never the one shown last time. `random` returns a number in [0, 1), like Math.random;
 * injected so tests are deterministic.
 */
export function pickHomeGreeting(random: () => number = Math.random, last: number | null = null): { index: number; greeting: HomeGreeting } {
  const choices = HOME_GREETINGS.map((_, index) => index).filter((index) => index !== last);
  const pick = choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
  return { index: pick, greeting: HOME_GREETINGS[pick] };
}
