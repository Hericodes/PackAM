"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { usePaymentPolling } from "../payments/usePaymentPolling";
import type { PrintCheckoutSnapshot } from "../../lib/printing/payment-snapshot";
import { PAYMENT_COPY } from "../../lib/student-copy";

type PaymentState = "PENDING" | "SUCCESS" | "FAILED" | "RECONCILIATION_REQUIRED" | "ERROR";

type Props = {
  printJobId: string;
  paymentReference: string;
  initialStatus: string;
  cashierUrl: string | null;
  snapshot: PrintCheckoutSnapshot;
};

const money = (amount: number) => `₦${amount.toLocaleString()}`;

export function PrintPaymentStatus({
  printJobId,
  paymentReference,
  initialStatus,
  cashierUrl,
  snapshot,
}: Props) {
  const initialState = initialStatus === "SUCCESS" || initialStatus === "FAILED" || initialStatus === "RECONCILIATION_REQUIRED"
    ? initialStatus
    : "PENDING";
  const [state, setState] = useState<PaymentState>(initialState);
  const [checking, setChecking] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState(cashierUrl);

  const checkPayment = useCallback(async (): Promise<boolean> => {
    setChecking(true);
    try {
      const query = new URLSearchParams({ reference: paymentReference, printJobId });
      const response = await fetch(`/api/payments/opay/status?${query.toString()}`, { cache: "no-store" });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object" || !("status" in result)) {
        throw new Error("Payment status is not available yet.");
      }
      const status = result.status;
      if (status === "SUCCESS" || status === "FAILED" || status === "RECONCILIATION_REQUIRED") {
        setState(status);
        return false;
      }
      setState("PENDING");
      return true;
    } catch {
      setState((current) => current === "PENDING" ? "ERROR" : current);
      return true;
    } finally {
      setChecking(false);
    }
  }, [paymentReference, printJobId]);

  async function startOrResumeCheckout() {
    if (startingCheckout) return;
    setStartingCheckout(true);
    setCheckoutError("");
    try {
      const storageKey = `packam-print-payment-attempt:${printJobId}`;
      let idempotencyKey = window.sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        window.sessionStorage.setItem(storageKey, idempotencyKey);
      }
      const response = await fetch(`/api/print-jobs/${encodeURIComponent(printJobId)}/payment`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        cache: "no-store",
      });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object") {
        const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
          ? result.error
          : "Payment couldn’t be started. Your print job is still safe — try again.";
        throw new Error(message);
      }
      window.sessionStorage.removeItem(storageKey);
      if ("cashierUrl" in result && typeof result.cashierUrl === "string") {
        setCheckoutUrl(result.cashierUrl);
        window.location.assign(result.cashierUrl);
        return;
      }
      await checkPayment();
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : "Payment couldn’t be started. Your print job is still safe — try again.");
    } finally {
      setStartingCheckout(false);
    }
  }

  // Backs off and stops after five minutes. Payments under review keep being re-checked, because the
  // status route re-verifies them with OPay and can complete them; final payments are never polled.
  const finalOnLoad = initialState === "SUCCESS" || initialState === "FAILED";
  const { timedOut, restart } = usePaymentPolling(useCallback(async () => !finalOnLoad && checkPayment(), [checkPayment, finalOnLoad]));

  const statusMessage = state === "SUCCESS"
    ? PAYMENT_COPY.successTitle
    : state === "FAILED"
      ? PAYMENT_COPY.failedTitle
      : state === "RECONCILIATION_REQUIRED"
        ? PAYMENT_COPY.reviewTitle
        : timedOut
          ? PAYMENT_COPY.pendingTitle
          : PAYMENT_COPY.checkingTitle;

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-2xl border border-black/5 bg-[#fffdf7] p-4 text-left sm:p-5" aria-labelledby="print-payment-summary">
        <h2 id="print-payment-summary" className="text-sm font-black">Print job summary</h2>
        <p className="mt-3 break-words text-sm font-bold">{snapshot.documentName}</p>
        <p className="mt-1 text-sm leading-5 text-black/55">
          {snapshot.colorMode === "COLOR" ? "Colour" : "Black & white"} · {snapshot.sides === "DOUBLE" ? "Double-sided" : "Single-sided"} · A4 · {snapshot.copies} {snapshot.copies === 1 ? "copy" : "copies"}
        </p>
        <p className="mt-1 text-sm leading-5 text-black/55">
          {snapshot.pageSelection === "ALL" ? "All pages" : `Pages ${snapshot.pageSelection}`} · {snapshot.selectedPageCount} {snapshot.selectedPageCount === 1 ? "page" : "pages"}
        </p>
        <p className="mt-3 text-sm leading-5 text-black/65">{snapshot.deliveryAddress}</p>
        <p className="mt-4 flex justify-between gap-3 border-t border-black/10 pt-4 text-base font-black">
          <span>Total</span><span>{money(snapshot.total)}</span>
        </p>
      </section>

      <section className="text-center" aria-live="polite">
        {state === "SUCCESS" ? (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl font-black text-green-800" aria-hidden="true">✓</div>
            <h1 className="mt-4 text-2xl font-black">{statusMessage}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-black/60">We dey find a runner for your print job 🖨️</p>
          </>
        ) : state === "FAILED" ? (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl font-black text-red-800" aria-hidden="true">!</div>
            <h1 className="mt-4 text-2xl font-black">{statusMessage}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-black/60">Your print job never start, but it’s still saved. Go back to printing to try again.</p>
          </>
        ) : (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-black motion-reduce:animate-none" aria-hidden="true" />
            <h1 className="mt-4 text-2xl font-black">{statusMessage}</h1>
            <p role="status" className="mx-auto mt-2 max-w-sm text-sm leading-6 text-black/70">{state === "RECONCILIATION_REQUIRED"
              ? PAYMENT_COPY.reviewBody
              : timedOut
                ? PAYMENT_COPY.slowBody("your print job starts")
                : PAYMENT_COPY.checkingBody}</p>
            {(timedOut || state === "RECONCILIATION_REQUIRED") && <p className="mx-auto mt-2 max-w-sm break-all text-xs text-black/60">Payment reference: {paymentReference} · <Link href="/support" className="font-bold underline">Get help</Link></p>}
          </>
        )}

        {initialStatus === "PENDING" && (state === "PENDING" || state === "ERROR") && checkoutUrl && (
          <a href={checkoutUrl} className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-black px-5 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto">
            Return to OPay checkout
          </a>
        )}
        {initialStatus === "PENDING" && (state === "PENDING" || state === "ERROR") && !checkoutUrl && (
          <button
            type="button"
            onClick={() => void startOrResumeCheckout()}
            disabled={startingCheckout}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-black px-5 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-50 sm:w-auto"
          >
            {startingCheckout ? "Opening OPay…" : "Continue to OPay"}
          </button>
        )}
        {checkoutError && <p role="alert" className="mt-3 text-sm text-red-700">{checkoutError}</p>}
        {state !== "SUCCESS" && state !== "FAILED" && (
          <button
            type="button"
            onClick={() => { if (timedOut) restart(); else void checkPayment(); }}
            disabled={checking}
            className="mt-3 inline-flex min-h-11 items-center justify-center px-4 text-sm font-bold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-50 sm:ml-2"
          >
            {checking ? "Checking…" : "Check again"}
          </button>
        )}
        {state === "FAILED" && (
          <Link href="/printing" className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-black px-5 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto">
            Back to printing
          </Link>
        )}
        {state === "SUCCESS" && (
          <Link href={`/printing/jobs/${encodeURIComponent(printJobId)}`} className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-black px-5 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto">
            Track print job
          </Link>
        )}
      </section>
    </div>
  );
}
