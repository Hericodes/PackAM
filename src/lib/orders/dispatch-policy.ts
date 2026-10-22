/**
 * Runner dispatch decisions for paid orders and print jobs. Pure, so every rule is unit-tested; the
 * database work lives in dispatch.ts.
 *
 * Three different things, deliberately separate:
 * - Offer expiry: one runner's offer stays open for the offer window (RUNNER_ACCEPTANCE_TIMEOUT_MINUTES,
 *   default 30) from its own `offeredAt`. An expired offer is marked EXPIRED; the mission is not.
 * - Redispatch: a mission still waiting for a runner is offered to every verified, available runner who
 *   has never been offered it. Runners who declined (REJECTED) or let an offer expire (EXPIRED) are not
 *   offered the same mission again; the (mission, runner) unique key makes that impossible anyway.
 * - Refund review: only when the dispatch deadline (RUNNER_DISPATCH_DEADLINE_MINUTES, default 120) has
 *   passed AND nothing can still progress (no live offer, no untried eligible runner). Until then the
 *   mission stays FINDING_RUNNER and is retried. Refund review starts the refund workflow; it never
 *   claims money was returned.
 */

export const DEFAULT_DISPATCH_DEADLINE_MINUTES = 120;
export const MAX_DISPATCH_DEADLINE_MINUTES = 2880;

/** Earliest time (minutes after a mission starts looking for a runner) it may go to refund review. */
export function getDispatchDeadlineMinutes(offerWindowMinutes: number, environment: Record<string, string | undefined> = process.env) {
  const value = Number(environment.RUNNER_DISPATCH_DEADLINE_MINUTES ?? String(DEFAULT_DISPATCH_DEADLINE_MINUTES));
  const valid = Number.isInteger(value) && value >= 1 && value <= MAX_DISPATCH_DEADLINE_MINUTES ? value : DEFAULT_DISPATCH_DEADLINE_MINUTES;
  // A mission can't be given up before at least one offer has had a full window to be accepted.
  return Math.max(valid, offerWindowMinutes);
}

export type OfferRecord = { id: string; runnerId: string; status: string; offeredAt: Date };

/** An offer a runner can still accept right now. */
export function isOfferLive(offer: { status: string; offeredAt: Date }, now: Date, offerWindowMinutes: number) {
  return offer.status === "OFFERED" && now.getTime() - offer.offeredAt.getTime() <= offerWindowMinutes * 60_000;
}

export function offerCutoff(now: Date, offerWindowMinutes: number) {
  return new Date(now.getTime() - offerWindowMinutes * 60_000);
}

export type DispatchOutcome =
  | "NOT_DISPATCHABLE" // already assigned, delivered, refunding, cancelled…
  | "OFFERED" // new offers went out (first dispatch or redispatch)
  | "WAITING_ON_OFFERS" // at least one offer is still open
  | "WAITING_FOR_RUNNERS" // nobody eligible right now; stays recoverable and is retried
  | "REFUND_REVIEW"; // deadline passed and nothing can progress

export type DispatchPlan = { outcome: DispatchOutcome; expireOfferIds: string[]; offerRunnerIds: string[] };

export function planDispatch(input: {
  mission: { status: string; assignedRunnerId: string | null; findingRunnerAt: Date | null };
  offers: OfferRecord[];
  /** Runners who are verified, available and active right now. */
  eligibleRunnerIds: string[];
  now: Date;
  offerWindowMinutes: number;
  deadlineMinutes: number;
}): DispatchPlan {
  const { mission, offers, now } = input;
  if (mission.status !== "FINDING_RUNNER" || mission.assignedRunnerId) return { outcome: "NOT_DISPATCHABLE", expireOfferIds: [], offerRunnerIds: [] };

  const expireOfferIds = offers.filter((offer) => offer.status === "OFFERED" && !isOfferLive(offer, now, input.offerWindowMinutes)).map((offer) => offer.id);
  const tried = new Set(offers.map((offer) => offer.runnerId));
  const offerRunnerIds = [...new Set(input.eligibleRunnerIds)].filter((runnerId) => !tried.has(runnerId));
  const liveOffers = offers.filter((offer) => isOfferLive(offer, now, input.offerWindowMinutes)).length;

  // Anyone new who can take it gets it, even past the deadline: a recoverable mission is never refunded.
  if (offerRunnerIds.length) return { outcome: "OFFERED", expireOfferIds, offerRunnerIds };
  if (liveOffers > 0) return { outcome: "WAITING_ON_OFFERS", expireOfferIds, offerRunnerIds: [] };
  const deadlinePassed = mission.findingRunnerAt !== null && now.getTime() - mission.findingRunnerAt.getTime() > input.deadlineMinutes * 60_000;
  return { outcome: deadlinePassed ? "REFUND_REVIEW" : "WAITING_FOR_RUNNERS", expireOfferIds, offerRunnerIds: [] };
}

/** Whether a runner's own offer can still be accepted (per-offer window, not the mission's age). */
export function offerStillAcceptable(offer: { status: string; offeredAt: Date }, now: Date, offerWindowMinutes: number) {
  return isOfferLive(offer, now, offerWindowMinutes);
}
