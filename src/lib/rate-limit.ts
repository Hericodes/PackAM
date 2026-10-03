import "server-only";

import { createHash } from "node:crypto";
import { db } from "./db";

const fallback = new Map<string, { count: number; expiresAt: number }>();
let lastStorageWarning = 0;

/** Shared database fixed-window limiter. Uses atomic upsert/increment across app instances. */
export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = new Date();
  const hashedKey = createHash("sha256").update(key).digest("hex");
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs * 2);
  try {
    const bucket = await db.rateLimitBucket.upsert({
      where: { key_windowStart: { key: hashedKey, windowStart } },
      create: { key: hashedKey, windowStart, expiresAt, count: 1 },
      update: { count: { increment: 1 }, expiresAt },
      select: { count: true },
    });
    if (Math.random() < 0.01) await db.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } });
    return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000)) };
  } catch (error) {
    // A process-local fallback keeps the app usable during the migration window;
    // shared, race-safe enforcement is provided by PostgreSQL once migrated.
    if (Date.now() - lastStorageWarning > 60_000) {
      lastStorageWarning = Date.now();
      console.error("RATE LIMIT STORAGE ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
    const fallbackKey = `${hashedKey}:${windowStart.getTime()}`;
    const bucket = fallback.get(fallbackKey);
    const count = bucket?.expiresAt && bucket.expiresAt > now.getTime() ? bucket.count + 1 : 1;
    fallback.set(fallbackKey, { count, expiresAt: windowStart.getTime() + windowMs });
    for (const [entry, value] of fallback) if (value.expiresAt < now.getTime()) fallback.delete(entry);
    return { allowed: count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000)) };
  }
}

export function clientAddress(request: Request) {
  const trustedAddress = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return trustedAddress || forwarded || "unknown";
}
