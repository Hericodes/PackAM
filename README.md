This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## OPay Express Checkout

Payment credentials are server-only. Add these variables to the deployment environment; do not use `NEXT_PUBLIC_` prefixes or commit credential values:

```dotenv
OPAY_ENVIRONMENT=sandbox
OPAY_MERCHANT_ID=
OPAY_PUBLIC_KEY=
OPAY_SECRET_KEY=
APP_URL=https://your-packam-domain.example
```

`OPAY_ENVIRONMENT` accepts `sandbox` (the development default) or `production`. PackAM uses OPay's Nigeria hosts: `https://testapi.opaycheckout.com` for sandbox and `https://liveapi.opaycheckout.com` for production. Confirm these hosts are enabled for the merchant account before testing. `APP_URL` is the canonical origin used for OPay return and webhook URLs; use HTTPS in production. Configure `/api/webhooks/opay` as the merchant dashboard webhook URL as well.

PackAM stores NGN amounts as whole naira. OPay Cashier create/status `amount.total` uses the minor unit (kobo), so the server sends `amount * 100` (₦3,700 becomes `370000`) and verifies that representation against the status API. The callback docs describe `payload.amount` in NGN, so callbacks are compared to the whole-naira database amount before PackAM performs the authenticated status query. Students return to `/checkout/payment-result`; only a signed callback followed by that status query can finalize an order.

The `20261002103000_payment_attempt_lifecycle`, `20261003120000_opay_cashier`, and `20261003130000_fulfilment_engine` Prisma migrations must be applied to the target database before these flows are used. Apply migrations using the normal deployment procedure; do not reset the database.

## Orders and fulfilment

Student orders are available at `/orders`. Verified runners use `/runner` to set availability, accept offered missions, record sourcing, and mark deliveries complete. Any price increase requires student approval unless `PRICE_CHANGE_TOLERANCE_AMOUNT` and/or `PRICE_CHANGE_TOLERANCE_PERCENT` are configured. Leaving both unset requires approval for every increase.

Set `RUNNER_ACCEPTANCE_TIMEOUT_MINUTES` to control how long an unclaimed paid order waits (default 15). Configure a platform scheduler to POST `/api/internal/fulfilment/run-due` periodically with `Authorization: Bearer $FULFILMENT_CRON_SECRET`; the job moves overdue unclaimed orders into refund processing. Add `FULFILMENT_CRON_SECRET` as a server-only secret. Refund processing creates an idempotent pending refund request and cancels fulfilment; it does not claim that OPay has sent money back. An operator/provider refund action and confirmation are still required.

The `20261003130000_fulfilment_engine` migration adds fulfilment and sourcing fields; `20261003150000_product_request_variant` adds the optional variant field for student requests. Database migration state must be checked and migrations deployed separately; this project does not auto-apply schema changes.

## Student requests and operations

Students can request an item at `/product-requests` or from search. Admins use `/admin` for live database counts and `/admin/orders`, `/admin/requests`, `/admin/payments`, `/admin/vendors`, `/admin/runners`, and `/admin/exceptions` to review current work. Lists are capped or paginated to keep queries bounded. Runner delivery starts only after the assigned runner's order is in `SOURCING_PRODUCT` and every ordered unit has been sourced or approved; the runner then records `OUT_FOR_DELIVERY` and `DELIVERED` through the existing order transition service.

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
