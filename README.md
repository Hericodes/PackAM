This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## OPay Express Checkout

Payment credentials are server-only. Add these variables to the deployment environment; do not use `NEXT_PUBLIC_` prefixes or commit credential values:

```dotenv
OPAY_ENVIRONMENT=sandbox
OPAY_MERCHANT_ID=
OPAY_PUBLIC_KEY=
OPAY_SECRET_KEY=
APP_URL=https://www.packam.app
```

`OPAY_ENVIRONMENT` accepts `sandbox` (the development default) or `production`. PackAM uses OPay's Nigeria hosts: `https://testapi.opaycheckout.com` for sandbox and `https://liveapi.opaycheckout.com` for production. Confirm these hosts are enabled for the merchant account before testing. `APP_URL` is the canonical origin used for OPay return and webhook URLs; use HTTPS in production. Configure `/api/webhooks/opay` as the merchant dashboard webhook URL as well.

PackAM stores NGN amounts as whole naira. OPay Cashier create/status `amount.total` uses the minor unit (kobo), so the server sends `amount * 100` (₦3,700 becomes `370000`) and verifies that representation against the status API. The callback docs describe `payload.amount` in NGN, so callbacks are compared to the whole-naira database amount before PackAM performs the authenticated status query. Students return to `/checkout/payment-result`; only a signed callback followed by that status query can finalize an order.

The `20261002103000_payment_attempt_lifecycle`, `20261003120000_opay_cashier`, and `20261003130000_fulfilment_engine` Prisma migrations must be applied to the target database before these flows are used. Apply migrations using the normal deployment procedure; do not reset the database.

## Domain

The canonical production address is `https://www.packam.app`. Set `APP_URL` to it in the Vercel Production environment: every emailed link and payment return or webhook URL is built from `APP_URL`. In Vercel → Settings → Domains, add `www.packam.app` as the primary domain and `packam.app` redirecting to it (`next.config.ts` also redirects the apex as a fallback). The earlier `packam.vercel.app` address keeps working, so apps installed from it still open, but it is served with `X-Robots-Tag: noindex` so search engines index only the www domain. `robots.txt` and `sitemap.xml` point at the www domain.

Production endpoints on that domain (all built from `APP_URL`, so nothing else needs changing in code):

- Paystack webhook (Paystack dashboard → Settings → API Keys & Webhooks): `https://www.packam.app/api/webhooks/paystack`
- OPay webhook / callback (OPay merchant dashboard; PackAM also sends it with every transaction): `https://www.packam.app/api/webhooks/opay`
- Payment return pages: `https://www.packam.app/checkout/payment-result` (orders) and `https://www.packam.app/printing/payment/<printJobId>` (printing)
- Scheduled dispatch (GitHub secret `PACKAM_BASE_URL` = `https://www.packam.app`): `POST https://www.packam.app/api/internal/fulfilment/run-due`

## Delivery tiers migration (`20261101150000_delivery_tiers`)

Additive only (one enum, two new tables, seeded Cruise Mode ₦200, Sharp Sharp ₦300, Oya Now! ₦400, all on). The app runs with or without it: before it, checkout offers Cruise Mode at ₦200 only; once applied, the other speeds switch on without a redeploy.

- **If it fails on its 5-second lock timeout** (a busy moment): nothing was applied and the app keeps working, but Prisma records the migration as failed. Run `npx prisma migrate resolve --rolled-back 20261101150000_delivery_tiers`, then deploy again at a quieter time.
- **Rollback** (only while no Sharp Sharp or Oya Now! payment is pending): `DROP TABLE "OrderDeliveryTier"; DROP TABLE "DeliveryTierSetting"; DROP TYPE "DeliveryTier";` and then `DELETE FROM "_prisma_migrations" WHERE migration_name = '20261101150000_delivery_tiers';`, so a later deploy re-applies it.
- **Before rolling the code back** to a build without tiers, check for unpaid urgent attempts: `SELECT id FROM "Payment" WHERE "printJobId" IS NULL AND "orderId" IS NULL AND status IN ('PENDING','RECONCILIATION_REQUIRED') AND "checkoutSnapshot"->>'deliveryTier' IN ('OYA','SHARP');`. Afterwards, find paid orders that lost their speed: `SELECT p."orderId" FROM "Payment" p LEFT JOIN "OrderDeliveryTier" t ON t."orderId" = p."orderId" WHERE p."orderId" IS NOT NULL AND t."orderId" IS NULL AND p."checkoutSnapshot"->>'deliveryTier' IN ('OYA','SHARP');`

## Account email (Resend)

Account emails (email confirmation, password reset and security notices) go through [Resend](https://resend.com). Verify the sending domain `mail.packam.app` in Resend and add exactly the DNS records Resend shows for it, then set these in the Vercel Production environment only and redeploy:

```dotenv
RESEND_API_KEY=
EMAIL_FROM="PackAM <no-reply@mail.packam.app>"
APP_URL=https://www.packam.app
```

Keep Resend's click and open tracking off for this domain: tracking would route password-reset links through Resend's redirect service. Until both variables are set, password reset shows "Reset by email isn't available right now" and nothing is sent.

## Orders and fulfilment

Student orders are available at `/orders`. Verified runners use `/runner` to set availability, accept offered missions, record sourcing, and mark deliveries complete. Any price increase requires student approval unless `PRICE_CHANGE_TOLERANCE_AMOUNT` and/or `PRICE_CHANGE_TOLERANCE_PERCENT` are configured. Leaving both unset requires approval for every increase.

Set `RUNNER_ACCEPTANCE_TIMEOUT_MINUTES` to control how long an unclaimed paid order waits (default 15). Configure a platform scheduler to POST `/api/internal/fulfilment/run-due` periodically with `Authorization: Bearer $FULFILMENT_CRON_SECRET`; the job moves overdue unclaimed orders into refund processing. Add `FULFILMENT_CRON_SECRET` as a server-only secret. Refund processing creates an idempotent pending refund request and cancels fulfilment; it does not claim that OPay has sent money back. An operator/provider refund action and confirmation are still required.

The `20261003130000_fulfilment_engine` migration adds fulfilment and sourcing fields; `20261003150000_product_request_variant` adds the optional variant field for student requests. Database migration state must be checked and migrations deployed separately; this project does not auto-apply schema changes.

## Ordering hours and delivery area

Students can place orders **Monday to Friday, 8am to 5pm campus time** (Africa/Lagos). Evenings, early mornings and weekends are closed. While closed, students can still browse, build plates and fill their cart, but no new payment starts. Shop and food checkout and printing all follow this rule. The server refuses with `409 ORDERING_CLOSED`, and checkout and printing show when ordering opens, for example "Ordering opens Monday at 8am". A payment started before closing can still be finished after it.

Both can be changed without a code change, in the deployment environment:

- `ORDERING_HOURS`: `HH:MM-HH:MM` in campus time, for example `07:30-18:00`. `00:00-24:00` means all day.
- `ORDERING_DAYS`: days and ranges, for example `MON-SAT` or `MON,WED,FRI`. `SUN-SAT` means every day.

If either is unset or invalid, it falls back to the default: 8am–5pm, Monday to Friday. Database tests run always open, with `00:00-24:00` and `SUN-SAT` (see `src/test-support/db-harness.ts`).

PackAM delivers only on **OOU main campus, Ago-Iwoye**: a 2 km circle around the campus centre taken from OpenStreetMap, defined in `src/config/service-area.ts`. Checkout and printing start from the phone's live location. A live pin outside the circle is refused, both by `POST /api/locations` and when payment starts (`OUTSIDE_SERVICE_AREA`). Only when live location fails (permission denied, no position, too slow, an unsupported browser, or a fix too rough to check) can the student type a location, and then they must confirm it is on campus.

## Student requests and operations

Students can request an item at `/product-requests` or from search. Admins use `/admin` for live database counts and `/admin/orders`, `/admin/requests`, `/admin/payments`, `/admin/vendors`, `/admin/runners`, and `/admin/exceptions` to review current work. `/admin/delivery-tiers` sets the fee and on/off switch of each marketplace and food delivery speed (Cruise Mode, Sharp Sharp, Oya Now!); delivery windows and descriptions are fixed, at least one speed always stays on, and every change is written to the audit log. Printing keeps its own fixed delivery fee. Until migration `20261101150000_delivery_tiers` is applied the page explains this and refuses edits, and checkout offers Cruise Mode only. Lists are capped or paginated to keep queries bounded. Runner delivery starts only after the assigned runner's order is in `SOURCING_PRODUCT` and every ordered unit has been sourced or approved; the runner then records `OUT_FOR_DELIVERY` and `DELIVERED` through the existing order transition service.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## PackAM pilot operations

Operational pages are protected by the `ADMIN` role at `/admin`. `/admin/finance` reports only amounts recorded by successful orders, completed refunds, and paid runner payouts. It does not treat customer GMV as PackAM revenue. Vendor settlement, a commission base/rate calculation, processor fees, customer credits, and contribution margin are not currently persisted; those figures must not be inferred from the dashboard.

Notifications are written from server-side state transitions and use a per-user idempotency key. Support and sensitive admin updates write an `AuditLog`. The shared rate limiter uses PostgreSQL after migrations are deployed; while its table is unavailable it falls back to a best-effort per-process limiter and logs a sanitized warning.

### Database and recovery

Deploy Prisma migrations through the normal reviewed release process. Do not reset a live database. Before a pilot, confirm Neon backup/restore retention and rehearse a restore using the Neon project’s configured recovery features; no application-managed backup job is configured here. The database credential was exposed during development and must be rotated before production. Do not paste it into issue reports or logs.

### Operational schedule

Configure the deployment scheduler to call `POST /api/internal/fulfilment/run-due` with the `FULFILMENT_CRON_SECRET` bearer token. The application does not start this schedule itself. Confirm the scheduler and secret in the deployment environment before relying on automatic expiry of unclaimed missions.
