/**
 * Serializable transactions abort with P2034 when concurrent work conflicts (e.g. several runners
 * accepting at once, or a webhook and a status poll finalising the same payment). Postgres expects
 * the client to retry such transactions; each retry re-reads committed state, so guards and
 * idempotency checks decide the outcome correctly.
 */
export function isSerializationFailure(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034";
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
