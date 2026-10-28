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

test("schema behind code: missing columns or tables from any query are recognised, other errors are not", async () => {
  const { isSchemaBehindCode, missingSchemaElement, schemaBehindCodeResponse } = await import("./db-errors");
  // The exact shape seen when the Food code ran on a database without its migration.
  const missingColumn = { code: "P2022", message: "Invalid `db.cart.findUnique()` invocation:\n\nThe column `CartItem.configKey` does not exist in the current database.", meta: { modelName: "Cart", driverAdapterError: { cause: { kind: "ColumnNotFound" } } } };
  const missingTable = { code: "P2021", message: "The table `public.CartItemExtra` does not exist in the current database." };
  assert.equal(isSchemaBehindCode(missingColumn), true);
  assert.equal(isSchemaBehindCode(missingTable), true);
  assert.equal(isSchemaBehindCode({ message: "error: column \"shopId\" does not exist (42703)" }), true);
  assert.equal(missingSchemaElement(missingColumn), "CartItem.configKey");
  assert.equal(missingSchemaElement(missingTable), "public.CartItemExtra");
  for (const other of [null, "boom", { code: "P2002", message: "Unique constraint failed" }, { code: "P1001", message: "Can't reach database server" }, new Error("timeout")]) {
    assert.equal(isSchemaBehindCode(other), false, String((other as { code?: string })?.code ?? other));
  }

  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.join(" ")); };
  try {
    const response = schemaBehindCodeResponse(missingColumn, "GET /api/cart");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "120");
    const body = await response.json();
    assert.deepEqual(body, { error: "PackAM is being updated. Your cart is safe — please try again in a few minutes.", code: "SERVICE_UPDATING" });
    assert.doesNotMatch(JSON.stringify(body), /configKey|Prisma|column|database/i, "nothing about the database reaches the browser");
    assert.match(String(logged[0]), /GET \/api\/cart.*missing CartItem\.configKey.*prisma migrate deploy/, "the server log names the missing column and the fix");
  } finally {
    console.error = original;
  }
});
