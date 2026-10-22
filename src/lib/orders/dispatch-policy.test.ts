import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DISPATCH_DEADLINE_MINUTES, getDispatchDeadlineMinutes, isOfferLive, offerStillAcceptable, planDispatch, type OfferRecord } from "./dispatch-policy";
import { DEFAULT_RUNNER_ACCEPTANCE_TIMEOUT_MINUTES, getRunnerAcceptanceTimeoutMinutes } from "./price-policy";

const now = new Date("2026-10-22T10:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const waiting = (startedMinutesAgo: number) => ({ status: "FINDING_RUNNER", assignedRunnerId: null, findingRunnerAt: minutesAgo(startedMinutesAgo) });
const offer = (runnerId: string, status: string, offeredMinutesAgo: number): OfferRecord => ({ id: `offer-${runnerId}`, runnerId, status, offeredAt: minutesAgo(offeredMinutesAgo) });
const plan = (input: Partial<Parameters<typeof planDispatch>[0]>) => planDispatch({ mission: waiting(10), offers: [], eligibleRunnerIds: [], now, offerWindowMinutes: 30, deadlineMinutes: 120, ...input });

test("the offer window defaults to 30 minutes, keeps overrides and rejects invalid values", () => {
  assert.equal(DEFAULT_RUNNER_ACCEPTANCE_TIMEOUT_MINUTES, 30);
  assert.equal(getRunnerAcceptanceTimeoutMinutes({}), 30);
  assert.equal(getRunnerAcceptanceTimeoutMinutes({ RUNNER_ACCEPTANCE_TIMEOUT_MINUTES: "45" }), 45);
  for (const bad of ["0", "1441", "abc", "2.5", "-3"]) assert.equal(getRunnerAcceptanceTimeoutMinutes({ RUNNER_ACCEPTANCE_TIMEOUT_MINUTES: bad }), 30, bad);
});

test("the dispatch deadline defaults to 120 minutes and is never shorter than the offer window", () => {
  assert.equal(getDispatchDeadlineMinutes(30, {}), DEFAULT_DISPATCH_DEADLINE_MINUTES);
  assert.equal(getDispatchDeadlineMinutes(30, { RUNNER_DISPATCH_DEADLINE_MINUTES: "240" }), 240);
  assert.equal(getDispatchDeadlineMinutes(30, { RUNNER_DISPATCH_DEADLINE_MINUTES: "10" }), 30, "can't give up before one full offer window");
  assert.equal(getDispatchDeadlineMinutes(30, { RUNNER_DISPATCH_DEADLINE_MINUTES: "99999" }), 120);
});

test("an offer expires by its own age, not the mission's", () => {
  assert.equal(isOfferLive({ status: "OFFERED", offeredAt: minutesAgo(29) }, now, 30), true);
  assert.equal(isOfferLive({ status: "OFFERED", offeredAt: minutesAgo(31) }, now, 30), false);
  assert.equal(isOfferLive({ status: "REJECTED", offeredAt: minutesAgo(1) }, now, 30), false);
  assert.equal(offerStillAcceptable({ status: "OFFERED", offeredAt: minutesAgo(2) }, now, 30), true, "a fresh redispatched offer on an old mission");
});

test("an expired offer is closed and the mission is redispatched to an untried runner", () => {
  const result = plan({ mission: waiting(40), offers: [offer("A", "OFFERED", 40)], eligibleRunnerIds: ["A", "B"] });
  assert.deepEqual(result, { outcome: "OFFERED", expireOfferIds: ["offer-A"], offerRunnerIds: ["B"] });
});

test("a declined offer is redispatched and the decliner is never re-offered", () => {
  const result = plan({ offers: [offer("A", "REJECTED", 2)], eligibleRunnerIds: ["A", "B", "C"] });
  assert.deepEqual(result.offerRunnerIds, ["B", "C"]);
  assert.equal(result.outcome, "OFFERED");
});

test("previously attempted runners (expired, rejected or cancelled) are excluded", () => {
  const offers = [offer("A", "EXPIRED", 60), offer("B", "REJECTED", 50), offer("C", "CANCELLED", 40)];
  assert.deepEqual(plan({ mission: waiting(70), offers, eligibleRunnerIds: ["A", "B", "C"] }).offerRunnerIds, []);
});

test("one expired offer never expires the whole mission", () => {
  const result = plan({ mission: waiting(45), offers: [offer("A", "OFFERED", 45)], eligibleRunnerIds: [] });
  assert.equal(result.outcome, "WAITING_FOR_RUNNERS", "inside the dispatch deadline it stays recoverable");
  assert.deepEqual(result.expireOfferIds, ["offer-A"]);
});

test("no eligible runner keeps the mission waiting; a later retry offers the runner who comes online", () => {
  const first = plan({ mission: waiting(5), eligibleRunnerIds: [] });
  assert.equal(first.outcome, "WAITING_FOR_RUNNERS");
  const later = plan({ mission: waiting(50), eligibleRunnerIds: ["D"] });
  assert.deepEqual({ outcome: later.outcome, offerRunnerIds: later.offerRunnerIds }, { outcome: "OFFERED", offerRunnerIds: ["D"] });
});

test("an open offer means wait, even past the deadline", () => {
  assert.equal(plan({ mission: waiting(500), offers: [offer("A", "OFFERED", 5)], eligibleRunnerIds: ["A"] }).outcome, "WAITING_ON_OFFERS");
});

test("refund review only when the deadline passed and nothing can progress", () => {
  const stuck = { offers: [offer("A", "EXPIRED", 200)], eligibleRunnerIds: ["A"] };
  assert.equal(plan({ mission: waiting(100), ...stuck }).outcome, "WAITING_FOR_RUNNERS", "before the deadline: keep trying");
  assert.equal(plan({ mission: waiting(121), ...stuck }).outcome, "REFUND_REVIEW");
  // An untried eligible runner after the deadline is redispatched instead of refunded.
  assert.equal(plan({ mission: waiting(500), offers: stuck.offers, eligibleRunnerIds: ["A", "B"] }).outcome, "OFFERED");
});

test("assigned, refunding or delivered missions are never dispatched", () => {
  for (const mission of [{ ...waiting(5), assignedRunnerId: "A" }, { ...waiting(5), status: "REFUND_PROCESSING" }, { ...waiting(5), status: "DELIVERED" }, { ...waiting(5), status: "PAYMENT_CONFIRMED" }]) {
    assert.deepEqual(plan({ mission, eligibleRunnerIds: ["B"], offers: [offer("A", "OFFERED", 90)] }), { outcome: "NOT_DISPATCHABLE", expireOfferIds: [], offerRunnerIds: [] }, mission.status);
  }
});

test("the stranded production case: paid, waiting, one expired offer, one untried available runner", () => {
  // Offer to runner A made at 08:20; runner B became available later; dispatch runs well after the deadline.
  const result = plan({ mission: waiting(150), offers: [offer("A", "OFFERED", 150)], eligibleRunnerIds: ["A", "B"] });
  assert.deepEqual(result, { outcome: "OFFERED", expireOfferIds: ["offer-A"], offerRunnerIds: ["B"] });
});

test("duplicate eligible ids never produce duplicate offers", () => {
  assert.deepEqual(plan({ eligibleRunnerIds: ["B", "B", "C"] }).offerRunnerIds, ["B", "C"]);
});
