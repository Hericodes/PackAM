import Link from "next/link";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";
import { orphanedSuccessfulMarketplacePaymentWhere } from "../../../lib/payments/orphaned-marketplace-payment";
import { CHECK_OUTCOME_DISPLAY, STALE_PENDING_AFTER_MS, formatUnresolvedFor, isUnresolvedPayment, reviewActions, type CheckOutcome } from "../../../lib/payments/payment-review-policy";
import { orderStatusDisplay, paymentStatusDisplay, printStatusDisplay } from "../../../lib/ops-status";
import { printMissionReference } from "../../../lib/printing/runner-mission-policy";
import { formatCampusTime } from "../../../lib/student-copy";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { PaymentReviewActions } from "../../../components/admin/PaymentReviewActions";
import { PAYMENT_REVIEW_MIGRATION, isPaymentReviewTableMissing } from "../../../lib/db-errors";
import { SUPPORTED_PROVIDERS, providerName } from "../../../lib/payments/provider-selection";

const CANCEL_MARKER = "checkout.cancelled_by_student";

const PAYMENT_FIELDS = {
  id: true, provider: true, status: true, amount: true, currency: true, transactionReference: true, providerReference: true, providerCheckoutReference: true, createdAt: true, paidAt: true, failedAt: true, updatedAt: true, orderId: true, printJobId: true,
  user: { select: { email: true } },
  order: { select: { status: true } },
  printJob: { select: { status: true } },
} as const;

/**
 * Payments needing review, with their review cases. If the review-case table hasn't been migrated
 * yet, the unresolved payments are still listed (without case data) so financial exposure stays
 * visible, and the page says which migration is missing instead of failing.
 */
async function loadReviewCandidates(staleBefore: Date) {
  const unresolved = [{ status: "RECONCILIATION_REQUIRED" as const }, orphanedSuccessfulMarketplacePaymentWhere, { status: "PENDING" as const, createdAt: { lte: staleBefore } }];
  try {
    const rows = await db.payment.findMany({
      where: { provider: { in: [...SUPPORTED_PROVIDERS] }, OR: [...unresolved, { reviewCase: { is: { status: "OPEN" } } }] },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { ...PAYMENT_FIELDS, reviewCase: { select: { status: true, lastCheckAt: true, lastCheckOutcome: true, lastCheckDetail: true, checkCount: true, closedAt: true, closeNote: true, escalatedAt: true } } },
    });
    return { rows, reviewCasesAvailable: true };
  } catch (error) {
    if (!isPaymentReviewTableMissing(error)) throw error;
    console.error(`ADMIN PAYMENTS: PaymentReviewCase table missing; apply migration ${PAYMENT_REVIEW_MIGRATION} (npx prisma migrate deploy). Showing payments without review cases.`);
    const rows = await db.payment.findMany({ where: { provider: { in: [...SUPPORTED_PROVIDERS] }, OR: unresolved }, orderBy: { createdAt: "asc" }, take: 100, select: PAYMENT_FIELDS });
    return { rows: rows.map((row) => ({ ...row, reviewCase: null })), reviewCasesAvailable: false };
  }
}

export default async function AdminPaymentsPage() {
  await requireRole("ADMIN");
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_PENDING_AFTER_MS);
  const [{ rows: candidates, reviewCasesAvailable }, payments, refunds] = await Promise.all([
    loadReviewCandidates(staleBefore),
    db.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, provider: true, amount: true, transactionReference: true, orderId: true, printJobId: true, user: { select: { email: true } } } }),
    db.refund.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, amount: true, reason: true, transactionReference: true, order: { select: { id: true, user: { select: { email: true } } } } } }),
  ]);
  const cancelMarkers = new Set((await db.auditLog.findMany({ where: { action: CANCEL_MARKER, resourceId: { in: candidates.map((p) => p.id) } }, select: { resourceId: true } })).map((row) => row.resourceId));

  const rows = candidates.map((payment) => {
    const unresolved = isUnresolvedPayment(payment, now);
    const caseStatus = payment.reviewCase?.status ?? null;
    return { payment, unresolved, caseStatus, actions: reviewActions({ paymentStatus: payment.status, orderId: payment.orderId, printJobId: payment.printJobId, printJobStatus: payment.printJob?.status ?? null, hasTransactionReference: Boolean(payment.transactionReference), checkoutCancelled: cancelMarkers.has(payment.id), caseStatus }) };
  });
  const open = rows.filter((row) => row.caseStatus !== "CLOSED");
  const closedUnresolved = rows.filter((row) => row.caseStatus === "CLOSED" && row.unresolved);

  const card = ({ payment, actions, unresolved }: (typeof rows)[number]) => {
    const status = paymentStatusDisplay(payment.status);
    const reviewCase = payment.reviewCase;
    const outcome = reviewCase?.lastCheckOutcome ? CHECK_OUTCOME_DISPLAY[reviewCase.lastCheckOutcome as CheckOutcome] : null;
    return <li key={payment.id} className="rounded-2xl bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={status.label} tone={status.tone} />
            {reviewCase?.status === "CLOSED" && <StatusBadge label="Case closed" tone="neutral" />}
            {reviewCase?.escalatedAt && <StatusBadge label="Escalated" tone="warning" />}
            {!unresolved && <StatusBadge label="Money state resolved" tone="success" />}
          </div>
          <p className="mt-2 text-lg font-black">{payment.currency} {payment.amount.toLocaleString()} <span className="text-sm font-semibold text-black/50">· {payment.user.email}</span></p>
        </div>
        <p className="text-right text-xs text-black/55">Unresolved for <strong className="text-black">{formatUnresolvedFor(payment.createdAt, now)}</strong><br />Created {formatCampusTime(payment.createdAt)}</p>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <div><dt className="inline text-black/50">PackAM reference: </dt><dd className="inline break-all font-semibold">{payment.transactionReference ?? "—"}</dd></div>
        <div><dt className="inline text-black/50">Provider: </dt><dd className="inline font-semibold">{providerName(payment.provider)}</dd></div>
        <div><dt className="inline text-black/50">Provider checkout ref: </dt><dd className="inline break-all font-semibold">{payment.providerCheckoutReference ?? "not created"}</dd></div>
        <div><dt className="inline text-black/50">Provider transaction: </dt><dd className="inline break-all font-semibold">{payment.providerReference ?? "none recorded"}</dd></div>
        <div><dt className="inline text-black/50">Paid at (provider-confirmed): </dt><dd className="inline font-semibold">{payment.paidAt ? formatCampusTime(payment.paidAt) : "not confirmed"}</dd></div>
        <div className="sm:col-span-2"><dt className="inline text-black/50">For: </dt><dd className="inline font-semibold">
          {payment.orderId ? <><Link className="underline" href={`/admin/orders/${payment.orderId}`}>Order</Link> · {orderStatusDisplay(payment.order?.status ?? "").label}</>
            : payment.printJobId ? <><Link className="underline" href={`/admin/print-jobs/${payment.printJobId}`}>Print job {printMissionReference(payment.printJobId)}</Link> · {printStatusDisplay(payment.printJob?.status ?? "").label}</>
              : cancelMarkers.has(payment.id) ? "Marketplace checkout (cancelled, no order)" : "Marketplace checkout (no order created)"}
        </dd></div>
      </dl>

      <div className="mt-3 rounded-xl bg-[#f7f5ee] p-3 text-xs leading-5">
        {reviewCase?.lastCheckAt && outcome ? <>
          <p><span className="font-black">Last admin check: </span>{outcome.label} · {formatCampusTime(reviewCase.lastCheckAt)} · {reviewCase.checkCount} {reviewCase.checkCount === 1 ? "check" : "checks"}</p>
          <p className="text-black/60">{outcome.meaning}{reviewCase.lastCheckDetail ? ` (${reviewCase.lastCheckDetail})` : ""}</p>
        </> : <p className="text-black/60">No admin verification yet. Last record change {formatCampusTime(payment.updatedAt)}.</p>}
        {payment.status === "SUCCESS" && !payment.orderId && !payment.printJobId && <p className="mt-1 font-semibold text-[#c92d24]">Money was captured but no order exists. This needs manual reconciliation (fulfil or refund through the payment provider) and a documented note.</p>}
        {reviewCase?.status === "CLOSED" && reviewCase.closeNote && <p className="mt-1"><span className="font-black">Closed{reviewCase.closedAt ? ` ${formatCampusTime(reviewCase.closedAt)}` : ""}: </span>{reviewCase.closeNote}</p>}
      </div>

      {reviewCasesAvailable && <PaymentReviewActions paymentId={payment.id} available={actions} />}
    </li>;
  };

  return <main className="min-h-screen"><div className="packam-container py-8">
    <p className="text-xs font-black uppercase tracking-widest text-black/40">Daily ops</p>
    <h1 className="mt-1 text-3xl font-black">Payments &amp; refunds</h1>
    <p className="mt-2 max-w-3xl text-sm text-black/60">Only the payment provider’s verified status record (OPay or Paystack) can mark a payment paid or failed. A timeout or error proves nothing, so those payments stay unresolved. Closing a review case is bookkeeping — it never says money was received, refunded or not received. A pending refund is not a completed provider refund.</p>

    {!reviewCasesAvailable && <div role="alert" className="mt-5 rounded-2xl border border-[#c92d24]/25 bg-[#ffe9e7] p-4 text-sm text-[#7a1a14]">
      <p className="font-black">Payment review actions are unavailable: a database migration hasn’t been applied.</p>
      <p className="mt-1 leading-6">The database is missing the review-case table from migration <code className="font-mono text-xs">{PAYMENT_REVIEW_MIGRATION}</code>. Unresolved payments are still listed below, but Retry verification, Cancel, Close, Reopen and Escalate stay hidden until the migration is applied (<code className="font-mono text-xs">npx prisma migrate deploy</code>). No payment records were changed.</p>
    </div>}
    <section aria-labelledby="review-open" className="mt-6">
      <h2 id="review-open" className="flex items-center gap-2 text-xl font-black">Payments needing review <span className={`rounded-full px-2 py-0.5 text-xs ${open.length ? "bg-[#c92d24] text-white" : "bg-black/10 text-black/60"}`}>{open.length}</span></h2>
      <p className="mt-1 text-xs text-black/55">Under review, captured without an order, still pending {Math.round(STALE_PENDING_AFTER_MS / 60_000)}+ minutes after checkout, or with an open case.</p>
      {open.length ? <ul className="mt-3 grid gap-3">{open.map(card)}</ul> : <p className="mt-3 rounded-2xl bg-white p-5 text-sm text-black/55">No payments need review. The money dey balance 🫡</p>}
    </section>

    {closedUnresolved.length > 0 && <section aria-labelledby="review-closed" className="mt-8">
      <h2 id="review-closed" className="flex items-center gap-2 text-xl font-black">Closed — money still unresolved <span className="rounded-full bg-[#fff3d6] px-2 py-0.5 text-xs text-[#a15c00]">{closedUnresolved.length}</span></h2>
      <p className="mt-1 text-xs text-black/55">These cases were closed with a note, but the payment itself is still unresolved, so the financial exposure stays visible here and in the overview count.</p>
      <ul className="mt-3 grid gap-3">{closedUnresolved.map(card)}</ul>
    </section>}

    <h2 className="mt-10 text-xl font-black">Recent payments</h2>
    <div className="mt-3 overflow-x-auto rounded-2xl bg-white"><table className="pk-stack-table w-full md:min-w-[760px] text-left text-sm"><thead className="bg-black/5 text-xs uppercase text-black/50"><tr>{["Student", "Status", "Amount", "Provider", "Reference", "For"].map((x) => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-black/5">{payments.map((p) => { const d = paymentStatusDisplay(p.status); return <tr key={p.id}><td data-label="Student" className="px-4 py-3">{p.user.email}</td><td data-label="Status" className="px-4 py-3"><StatusBadge label={d.label} tone={d.tone} /></td><td data-label="Amount" className="px-4 py-3">₦{p.amount.toLocaleString()}</td><td data-label="Provider" className="px-4 py-3">{p.provider}</td><td data-label="Reference" className="break-all px-4 py-3 md:max-w-52 md:truncate" title={p.transactionReference ?? ""}>{p.transactionReference ?? "—"}</td><td data-label="For" className="px-4 py-3">{p.orderId ? <Link className="underline" href={`/admin/orders/${p.orderId}`}>Order</Link> : p.printJobId ? <Link className="underline" href={`/admin/print-jobs/${p.printJobId}`}>Print job</Link> : "—"}</td></tr>; })}</tbody></table></div>

    <h2 className="mt-8 text-xl font-black">Refunds</h2>
    <div className="mt-3 overflow-x-auto rounded-2xl bg-white"><table className="pk-stack-table w-full md:min-w-[700px] text-left text-sm"><thead className="bg-black/5 text-xs uppercase text-black/50"><tr>{["Order", "Student", "Status", "Amount", "Reason", "Reference"].map((x) => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-black/5">{refunds.map((r) => <tr key={r.id}><td data-label="Order" className="px-4 py-3"><Link className="underline" href={`/admin/orders/${r.order.id}`}>{r.order.id}</Link></td><td data-label="Student" className="px-4 py-3">{r.order.user.email}</td><td data-label="Status" className="px-4 py-3">{r.status}</td><td data-label="Amount" className="px-4 py-3">₦{r.amount.toLocaleString()}</td><td data-label="Reason" className="px-4 py-3">{r.reason}</td><td data-label="Reference" className="px-4 py-3">{r.transactionReference ?? "—"}</td></tr>)}</tbody></table></div>
  </div></main>;
}
