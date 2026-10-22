# Runner dispatch

How a paid order or print job reaches a runner, and what happens when nobody takes it.

## Lifecycle

1. **Payment verified** → the mission moves to `FINDING_RUNNER` and is offered to every runner who is
   verified, available and active at that moment.
2. **A runner goes available later** → every mission still `FINDING_RUNNER` that they haven't been offered
   is offered to them straight away (no age limit).
3. **Each offer has its own window** (`RUNNER_ACCEPTANCE_TIMEOUT_MINUTES`, default **30**), counted from
   when *that* offer was made. Runners only see offers inside their window; accepting after it fails with
   "This mission has expired." An expired offer is marked `EXPIRED`; the mission is **not** expired.
4. **Declining** marks the offer `REJECTED` and redispatches immediately.
5. **The scheduled pass** (every 5 minutes) expires stale offers and redispatches every waiting mission to
   verified, available runners who haven't been offered it. A runner who declined or let an offer expire is
   never offered the same mission again (enforced by the database's one-assignment-per-runner rule).
6. **Refund review** happens only when the **dispatch deadline** (`RUNNER_DISPATCH_DEADLINE_MINUTES`,
   default **120**, never shorter than the offer window) has passed **and** nothing can progress: no open
   offer and no untried eligible runner. The order moves to `REFUND_PROCESSING` with a **pending** refund
   and operations is alerted. No money is returned automatically: complete the refund in the payment
   provider dashboard and record it in PackAM.
7. Until then a mission with no eligible runner stays `FINDING_RUNNER` and is retried by every pass.

Operations can also click **Redispatch to runners** on an admin order or print-job page to run step 5 for
that one mission immediately.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `RUNNER_ACCEPTANCE_TIMEOUT_MINUTES` | `30` (1–1440) | How long one offer stays open. |
| `RUNNER_DISPATCH_DEADLINE_MINUTES` | `120` (1–2880) | Earliest a mission nobody can take goes to refund review. |
| `CRON_SECRET` | none (required) | Shared secret for the scheduled endpoint. At least 16 characters. |

## Scheduling (Vercel Hobby)

Vercel Hobby only allows a Vercel Cron to run **once a day**, so:

- **Every 5 minutes:** `.github/workflows/fulfilment-dispatch.yml` (GitHub Actions) POSTs to
  `/api/internal/fulfilment/run-due` with `Authorization: Bearer <CRON_SECRET>`.
  Add repository secrets **`PACKAM_BASE_URL`** (your production URL) and **`CRON_SECRET`**
  (GitHub → Settings → Secrets and variables → Actions). GitHub may delay scheduled runs by a few minutes,
  and pauses schedules on repositories with no activity for 60 days.
- **Once a day (backup):** `vercel.json` registers a Vercel Cron for the same path. Vercel sends
  `CRON_SECRET` automatically when it is set in the project's environment variables.
- On **Vercel Pro**, change the `vercel.json` schedule to `*/5 * * * *` and the GitHub workflow can be removed.

Set the **same** `CRON_SECRET` value in Vercel (Production) and in the GitHub repository secret.
Generate one with `openssl rand -hex 32`.

## Safety

- Every dispatch step runs in a serializable transaction; offers are unique per (mission, runner), so
  concurrent runs, runners and admins can't create duplicate offers or double-assign a mission.
- Each call handles at most 25 orders and 25 print jobs; overlapping calls within a minute are skipped.
- The endpoint answers 401 without the secret, 503 if `CRON_SECRET` isn't configured, and 500 when a
  mission failed (it is retried on the next run).
