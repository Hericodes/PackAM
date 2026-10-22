import { cronSecretConfigured, isAuthorizedCronRequest } from "../../../../../lib/cron-auth";
import { expireUnclaimedRunnerOrders } from "../../../../../lib/orders/scheduled-work";
import { expireUnclaimedPrintJobs } from "../../../../../lib/printing/fulfilment-recovery";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled dispatch pass (every 5 minutes from GitHub Actions; once a day from Vercel Cron as a backup).
 * Requires `Authorization: Bearer <CRON_SECRET>`. Safe to retry: each mission is handled in its own guarded
 * serializable transaction, work per call is bounded, and overlapping calls are collapsed by a short lease.
 */
async function run(request: Request) {
  if (!cronSecretConfigured(process.env.CRON_SECRET)) {
    console.error("FULFILMENT SCHEDULE: CRON_SECRET is not configured; refusing to run.");
    return Response.json({ error: "Scheduled jobs are not configured." }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  // One run at a time: a second call within the lease is skipped, not queued (the next schedule picks up).
  const lease = await consumeRateLimit("fulfilment-run-due", 1, 60_000);
  if (!lease.allowed) return Response.json({ skipped: true, reason: "Another dispatch run started within the last minute." });
  try {
    const orders = await expireUnclaimedRunnerOrders();
    const printJobs = await expireUnclaimedPrintJobs();
    const failed = orders.failed + printJobs.failed;
    console.info(JSON.stringify({ event: "fulfilment_dispatch_run", orders, printJobs }));
    // 500 when any mission failed, so the scheduler shows the run as failed; the next run retries it.
    return Response.json({ orders, printJobs }, { status: failed ? 500 : 200 });
  } catch (error) {
    console.error("FULFILMENT SCHEDULE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Unable to process due fulfilment tasks." }, { status: 500 });
  }
}

/** Vercel Cron calls GET. */
export const GET = run;
/** Manual or external schedulers may POST. */
export const POST = run;
