import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isMissingTableError, isPaymentReviewTableMissing } from "./db-errors";

// The error the admin payments page actually threw before migration 20261020150000 was applied,
// as returned by Prisma 7 with the pg driver adapter (captured from a read-only query).
const ADAPTER_ERROR = Object.assign(new Error("Invalid `prisma.payment.findMany()` invocation"), {
  name: "PrismaClientKnownRequestError",
  code: "P2021",
  meta: { modelName: "Payment", driverAdapterError: { name: "DriverAdapterError", cause: { originalCode: "42P01", originalMessage: 'relation "public.PaymentReviewCase" does not exist', kind: "TableDoesNotExist", table: "public.PaymentReviewCase" } } },
});

test("the missing review-case table is recognised from the real driver-adapter error", () => {
  assert.equal(isPaymentReviewTableMissing(ADAPTER_ERROR), true);
});

test("the query-engine form of the same error is recognised too", () => {
  const engine = { code: "P2021", message: "The table `public.PaymentReviewCase` does not exist in the current database.", meta: { table: "public.PaymentReviewCase" } };
  assert.equal(isPaymentReviewTableMissing(engine), true);
});

test("other failures are not mistaken for a pending migration, so they still reach the error page", () => {
  const otherTable = { ...ADAPTER_ERROR, meta: { driverAdapterError: { cause: { originalCode: "42P01", originalMessage: 'relation "public.Payment" does not exist' } } } };
  assert.equal(isPaymentReviewTableMissing(otherTable), false, "a different missing table");
  assert.equal(isMissingTableError(otherTable, "Payment"), true);
  assert.equal(isPaymentReviewTableMissing({ code: "P2002", message: "Unique constraint failed on PaymentReviewCase" }), false, "a unique violation is not a missing table");
  assert.equal(isPaymentReviewTableMissing({ code: "P1001", message: "Can't reach database server" }), false);
  assert.equal(isPaymentReviewTableMissing(new Error("PaymentReviewCaseX timeout")), false);
  for (const value of [null, undefined, "P2021", 42]) assert.equal(isPaymentReviewTableMissing(value), false);
});

test("the marketplace page no longer shows the delivery-fee message", () => {
  const page = readFileSync(new URL("../app/search/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /Prices include everything/);
  assert.doesNotMatch(page, /added once per order/);
});
