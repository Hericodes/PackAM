import { timingSafeEqual } from "node:crypto";
import { expireUnclaimedRunnerOrders } from "../../../../../lib/orders/scheduled-work";

export const runtime = "nodejs";

function authorized(request: Request) {
  const secret = process.env.FULFILMENT_CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !supplied) return false;
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    return Response.json(await expireUnclaimedRunnerOrders());
  } catch (error) {
    console.error("FULFILMENT SCHEDULE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Unable to process due fulfilment tasks." }, { status: 500 });
  }
}
