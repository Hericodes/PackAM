# Paystack payments (with OPay retained)

PackAM can take payments through **Paystack** or **OPay**. Both share one payment core: the same
payment records, idempotency keys, checkout snapshots, order/print-job finalisation, payment-review
queue, cancellation rules and refund safeguards. Only the provider adapter differs.

## How a payment is confirmed

1. The server creates a PackAM payment attempt with a unique reference (`packam_<uuid>`) linked to the
   student's cart snapshot (orders) or print job, then initialises a Paystack transaction with the
   secret key and sends the student to Paystack's hosted checkout.
2. Paystack redirects the student back to PackAM. **The redirect proves nothing**; the result page asks
   the server, which calls Paystack's **Verify Transaction** API.
3. Paystack also calls the **webhook**. PackAM checks `x-paystack-signature` (HMAC-SHA512 of the raw
   body with the secret key), then again calls the Verify Transaction API. The webhook body itself is
   never trusted for status or amount.
4. A payment is finalised only when the verified record matches the attempt's **reference, amount (in
   kobo), currency (NGN)** and has a Paystack transaction id. Finalisation is idempotent: duplicate
   webhooks, a webhook racing the status poll, or retries create exactly one order or one print fulfilment.
5. Disagreement (amount, currency, reference, transaction id, or a reversed transaction) moves the
   payment to **review** (`RECONCILIATION_REQUIRED`) for an admin; it is never fulfilled automatically.
6. Timeouts, Paystack errors and unknown states keep the payment **pending** and are retried. Only
   Paystack `failed` marks a payment failed. `abandoned` stays pending, because the student can still
   finish paying on the same checkout page.

## Environment variables (server only)

| Variable | Required | Value |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | for Paystack | Your **test** secret key, `sk_test_…` (Paystack dashboard → Settings → API Keys & Webhooks). Never commit it. |
| `PAYMENT_PROVIDER` | to switch | `PAYSTACK` makes **new** checkouts use Paystack. Unset or `OPAY` keeps OPay (the default). |
| `PAYSTACK_LIVE_APPROVED` | for live keys only | Must be exactly `true` before an `sk_live_…` key is accepted. Without it, live keys are refused. |
| `APP_URL` | already required | Public HTTPS base URL, used for the callback and webhook URLs. |
| `OPAY_*` | unchanged | Keep the OPay variables so existing OPay attempts keep verifying and OPay can be reactivated. |

No public key is needed: PackAM uses Paystack's hosted checkout, not the inline popup.

## Exact URLs

Replace `https://<APP_URL>` with the value of `APP_URL` (HTTPS in production).

| What | URL | Where it's set |
|---|---|---|
| Webhook URL | `https://<APP_URL>/api/webhooks/paystack` | Paystack dashboard → Settings → API Keys & Webhooks (Test and Live) |
| Callback URL — orders | `https://<APP_URL>/checkout/payment-result` | Sent by PackAM with every order transaction; Paystack appends `?trxref=…&reference=…` |
| Callback URL — printing | `https://<APP_URL>/printing/payment/<printJobId>` | Sent by PackAM with every print transaction |

The callback URL only brings the student back; it never marks anything paid. You can leave the
dashboard's own "Callback URL" field empty, because the per-transaction URL takes precedence.

## Keys: which goes where

- `PAYSTACK_SECRET_KEY` must hold the **secret** key, which starts with `sk_test_` (test) or
  `sk_live_` (live). PackAM refuses a public key (`pk_…`) here and says so if the two look swapped.
- PackAM doesn't use the public key (`pk_…`); you don't need to set it.
- Start with the **test** secret key. A live key is refused unless `PAYSTACK_LIVE_APPROVED=true`.
- Keys live only in `.env` / your host's secret settings. `.env` is gitignored; never paste keys into code,
  tickets or chat. If a secret key may have been exposed, roll it in the Paystack dashboard.

## Paystack dashboard configuration

1. **Settings → API Keys & Webhooks**, in **Test mode**:
   - Copy the **Test Secret Key** into `PAYSTACK_SECRET_KEY`.
   - Set **Test Webhook URL** to `https://<APP_URL>/api/webhooks/paystack`.
   - The **Test Callback URL** can stay empty: PackAM sends a callback URL with every transaction
     (`/checkout/payment-result` for orders, `/printing/payment/<print job>` for printing).
2. Only after the test plan below passes and Paystack approves the business for live payments:
   repeat with the **Live** keys and **Live Webhook URL**, and set `PAYSTACK_LIVE_APPROVED=true`.

## Rolling out safely

1. Deploy this code with `PAYMENT_PROVIDER` unset: nothing changes, OPay keeps taking payments.
2. In a test/staging environment, set `PAYSTACK_SECRET_KEY=sk_test_…` and `PAYMENT_PROVIDER=PAYSTACK`,
   then test with Paystack's test cards: a successful order, a successful print job, a declined card,
   closing the checkout without paying, and paying late after closing the tab. Confirm the webhook
   deliveries show `200` in the Paystack dashboard and the admin payments page shows no unexpected reviews.
3. Run `npm test` and, against a disposable database, `npm run test:db`.
4. Switch production by setting `PAYMENT_PROVIDER=PAYSTACK` with live keys and `PAYSTACK_LIVE_APPROVED=true`.

**Rollback:** unset `PAYMENT_PROVIDER` (or set `OPAY`). New checkouts go back to OPay. Paystack
attempts already in progress keep verifying through Paystack, so no payment is stranded.

## Endpoints

| Path | Purpose |
|---|---|
| `POST /api/payments/create` | Start a marketplace checkout with the active provider. |
| `GET /api/payments/status` | Student status check; re-verifies with the attempt's own provider. |
| `POST /api/payments/cancel` | Cancel an unpaid checkout (reconciles with the provider first). |
| `POST /api/print-jobs/<id>/payment` | Start or resume a print-job checkout. |
| `POST /api/webhooks/paystack` | Paystack webhook (signature-verified). |
| `POST /api/webhooks/opay` | OPay callback (unchanged). |
| `/api/payments/opay/*` | Old paths, kept as aliases of the shared routes. |

## Known limitations

- Paystack has no fixed expiry for an unfinished checkout, so a Paystack payment the student abandons
  stays **pending**. Students can still pay or start a new checkout. Cancelling such an order or print job
  waits until Paystack reports it `failed`; admins see long-pending attempts in the payment review queue.
- Refunds are not automated for either provider. Refunds are issued in the provider dashboard and
  recorded through PackAM's existing refund workflow.
