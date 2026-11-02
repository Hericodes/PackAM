import assert from "node:assert/strict";
import { test } from "node:test";
import { isSerializationFailure, retrySerializable } from "./db-retry";

const conflict = () => Object.assign(new Error("write conflict"), { code: "P2034" });
const noSleep = async () => {};

test("serialization failures are retried until the work succeeds", async () => {
  let calls = 0;
  const result = await retrySerializable(async () => {
    calls += 1;
    if (calls < 3) throw conflict();
    return "won";
  }, { sleep: noSleep });
  assert.equal(result, "won");
  assert.equal(calls, 3);
});

test("retries stop at the attempt limit and surface the conflict", async () => {
  let calls = 0;
  await assert.rejects(retrySerializable(async () => { calls += 1; throw conflict(); }, { attempts: 4, sleep: noSleep }), /write conflict/);
  assert.equal(calls, 4);
});

test("other errors are never retried", async () => {
  let calls = 0;
  await assert.rejects(retrySerializable(async () => { calls += 1; throw new Error("Someone already picked this mission"); }, { sleep: noSleep }), /already picked/);
  assert.equal(calls, 1);
  assert.equal(isSerializationFailure(Object.assign(new Error("dup"), { code: "P2002" })), false);
  assert.equal(isSerializationFailure(null), false);
});

test("a conflict found at COMMIT (the pg adapter's raw error, no P2034) is retried too", async () => {
  const atCommit = Object.assign(new Error("could not serialize access due to read/write dependencies among transactions"), {
    name: "DriverAdapterError",
    cause: { kind: "TransactionWriteConflict", originalCode: "40001" },
  });
  assert.equal(isSerializationFailure(atCommit), true);
  assert.equal(isSerializationFailure(Object.assign(new Error("deadlock detected"), { name: "DriverAdapterError", cause: { kind: "Unknown", originalCode: "40P01" } })), true);
  let calls = 0;
  assert.equal(await retrySerializable(async () => { calls += 1; if (calls < 3) throw atCommit; return "saved"; }, { sleep: noSleep }), "saved");
  assert.equal(calls, 3);
  for (const other of [
    Object.assign(new Error("duplicate key"), { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", originalCode: "23505" } }),
    Object.assign(new Error("no cause"), { name: "DriverAdapterError" }),
    { name: "DriverAdapterError", cause: "TransactionWriteConflict" },
  ]) assert.equal(isSerializationFailure(other), false, JSON.stringify(other));
});
