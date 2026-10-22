import "server-only";

import { dispatchDueOrders } from "./dispatch";

/**
 * Scheduled pass for paid orders still looking for a runner. Safe to run repeatedly and concurrently:
 * expired offers are marked EXPIRED, the order is redispatched to untried available runners, and only an
 * order past its dispatch deadline that nobody can take moves to refund review (see dispatch-policy.ts).
 * One expired offer never expires the whole order.
 */
export async function expireUnclaimedRunnerOrders(now = new Date()) {
  const summary = await dispatchDueOrders(now);
  return { ...summary, refundsStarted: summary.refundReviews };
}
