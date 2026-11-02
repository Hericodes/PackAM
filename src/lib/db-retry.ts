/**
 * Serializable transactions abort with P2034 when concurrent work conflicts (e.g. several runners
 * accepting at once, or a webhook and a status poll finalising the same payment). Postgres expects
 * the client to retry such transactions; each retry re-reads committed state, so guards and
 * idempotency checks decide the outcome correctly.
 *
 * A conflict Postgres only finds when COMMIT runs comes back from Prisma 7.10 as the pg adapter's raw
 * DriverAdapterError (kind TransactionWriteConflict, Postgres 40001 or deadlock 40P01), without the P2034 code.
 * The transaction was rolled back all the same, so it is retried like any other conflict.
 */
export function isSerializationFailure(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; name?: unknown; cause?: unknown };
  if (candidate.code === "P2034") return true;
  if (candidate.name !== "DriverAdapterError" || typeof candidate.cause !== "object" || candidate.cause === null) return false;
  const cause = candidate.cause as { kind?: unknown; originalCode?: unknown };
  return cause.kind === "TransactionWriteConflict" || cause.originalCode === "40001" || cause.originalCode === "40P01";
}

export async function retrySerializable<T>(
  work: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 15;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isSerializationFailure(error) || attempt >= attempts) throw error;
      // Jittered backoff so competing transactions don't collide again in lockstep.
      await sleep(baseDelayMs * attempt + Math.floor(Math.random() * baseDelayMs * attempt));
    }
  }
}
