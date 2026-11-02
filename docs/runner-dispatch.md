# Runner dispatch

How a paid order or print job reaches a runner, and what happens when nobody takes it.

## Lifecycle

1. **Payment verified** → the mission moves to `FINDING_RUNNER` and is offered to every runner who is
   verified, available and active at that moment (Oya Now! and Sharp Sharp orders: only those with no active
   mission at first, see [Delivery tiers](#delivery-tiers)).
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

## Delivery tiers

Marketplace and food orders carry the delivery speed the student paid for (`OrderDeliveryTier`, frozen at
payment). Print jobs have no tier.

- **Priority:** Oya Now!, then Sharp Sharp, then Cruise Mode. Orders paid before delivery tiers ("Standard
  delivery") and print jobs rank with Cruise Mode. Each scheduled pass handles Oya Now! and Sharp Sharp orders
  first (oldest first), then everything else by how long it has waited; the runner board sorts the same way.
- **Idle-runner rule:** an Oya Now! or Sharp Sharp order is offered to, and can be accepted by, only runners
  with **no active mission** (no accepted, unfinished order or print job) until it escalates. Busy runners still
  get Cruise Mode and print offers.
- **One urgent mission at a time:** a runner holding an accepted Oya Now! or Sharp Sharp order can't accept any
  other mission (order or print job) until they deliver it. They still see offers; the board says why they
  can't take them. Cruise Mode orders batch as before, with no limit.
- **Escalation:** an urgent order still waiting for a runner **5 minutes** (Oya Now!) or **10 minutes** (Sharp
  Sharp) after payment is escalated by the next dispatch step (scheduled pass, a decline, or **Redispatch to
  runners**): `escalatedAt` is set once and every admin gets **one** "Urgent delivery not accepted" alert in
  Updates, however many passes run at once. The same step offers the order to every untried eligible runner.
- **Time-based lift:** the idle-runner rule ends at the threshold even if no pass has run yet, so a late
  scheduler never keeps an urgent order from busy runners for longer than promised.
- **Newly idle runners:** when a runner delivers their last mission (order or print job), waiting orders they
  haven't been offered, including urgent ones held back for idle runners, are offered to them straight away.
- An urgent order never goes to refund review before its idle-runner rule has lifted.
- **Before migration `20261101150000_delivery_tiers`:** no order has a tier, so dispatch, offers and acceptance
  behave exactly as described above without this section.

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
