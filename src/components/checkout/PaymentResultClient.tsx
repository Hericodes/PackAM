"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { usePaymentPolling } from "../payments/usePaymentPolling";
import { checkoutPaymentActions } from "../../lib/payments/checkout-cancellation";
import { PAYMENT_COPY } from "../../lib/student-copy";

type PaymentState = "CHECKING" | "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED" | "REVIEW" | "SIGNED_OUT" | "ERROR";

const primaryLink = "inline-flex min-h-12 w-full items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto";
const outlineButton = "inline-flex min-h-12 w-full items-center justify-center rounded-full border border-black/15 bg-white px-6 py-3 text-sm font-black text-black transition hover:border-black/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";
const secondaryLink = "inline-flex min-h-11 items-center justify-center px-3 text-sm font-bold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

export function PaymentResultClient({ reference }: { reference: string }) {
  const [state, setState] = useState<PaymentState>("CHECKING");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const checkPayment = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/payments/opay/status?reference=${encodeURIComponent(reference)}`, { cache: "no-store" });
      if (response.status === 401) {
        setState("SIGNED_OUT");
        return false;
      }
      const data = await response.json();
      if (!response.ok) throw new Error("Payment status is not available yet.");
      if (data.status === "SUCCESS") {
        if (typeof data.orderId === "string") setOrderId(data.orderId);
        setState("SUCCESS");
        return false;
      }
      if (data.status === "FAILED") {
        setState(data.cancelled === true ? "CANCELLED" : "FAILED");
        return false;
      }
      if (data.status === "RECONCILIATION_REQUIRED") {
        // Keep re-checking: the status route re-verifies with OPay and can still complete it.
        setState("REVIEW");
        return true;
      }
      setState("PENDING");
      return true;
    } catch {
      setState((current) => current === "CHECKING" ? "ERROR" : current);
      return true;
    }
  }, [reference]);

  const { timedOut, restart } = usePaymentPolling(checkPayment);

  async function cancelOrder() {
    if (cancelBusy) return;
    setCancelBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/payments/opay/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      });
      if (response.status === 401) {
        setState("SIGNED_OUT");
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (data.status === "CANCELLED") {
        setState("CANCELLED");
      } else if (data.status === "SUCCESS") {
        // A late success: the order exists and stays. Never present it as cancelled or refunded.
        if (typeof data.orderId === "string") setOrderId(data.orderId);
        setState("SUCCESS");
        setNotice(data.error ?? "");
      } else if (data.status === "RECONCILIATION_REQUIRED") {
        setState("REVIEW");
        setNotice(data.error ?? "");
      } else {
        setNotice(typeof data.error === "string" ? data.error : "We couldn’t cancel this order right now. Nothing has changed — please try again.");
      }
    } catch {
      setNotice("We couldn’t reach PackAM. Nothing has changed — please try again.");
    } finally {
      setCancelBusy(false);
      setConfirmingCancel(false);
    }
  }

  const actions = state === "FAILED" || state === "PENDING"
    ? checkoutPaymentActions({ status: state, orderId: null, cancelled: false })
    : { canRetry: false, canCancel: false };

  const noticeLine = notice && (
    <p role="alert" className="mx-auto mt-4 max-w-sm rounded-2xl bg-[#fff4c7] px-4 py-3 text-sm font-semibold leading-6 text-[#3d2c00]">{notice}</p>
  );

  const cancelControls = actions.canCancel && (
    confirmingCancel ? (
      <div role="group" aria-labelledby="cancel-confirm-title" className="mx-auto mt-6 max-w-sm rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-left">
        <p id="cancel-confirm-title" className="text-sm font-black">Cancel this order?</p>
        <p className="mt-1 text-sm leading-6 text-black/70">
          {state === "FAILED"
            ? "OPay didn’t complete this payment, so no order was placed. Cancelling removes these items from your cart."
            : "We’ll check with OPay first. If your payment has gone through, your order stays and won’t be cancelled. If it’s still being confirmed, nothing changes yet."}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => void cancelOrder()} disabled={cancelBusy} aria-busy={cancelBusy} className={`${primaryLink} disabled:cursor-wait disabled:opacity-60`}>
            {cancelBusy ? "Cancelling…" : "Yes, cancel order"}
          </button>
          <button type="button" onClick={() => setConfirmingCancel(false)} disabled={cancelBusy} className={outlineButton}>Keep order</button>
        </div>
      </div>
    ) : (
      <button type="button" onClick={() => { setNotice(""); setConfirmingCancel(true); }} className={outlineButton}>Cancel Order</button>
    )
  );

  if (state === "SUCCESS") return (
    <>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl font-black text-green-800" aria-hidden="true">✓</div>
      <h1 aria-live="polite" className="mt-5 text-2xl font-black sm:text-3xl">{PAYMENT_COPY.successTitle}</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">Order don enter! 🫡 We dey find a runner to bring your stuff.</p>
      {noticeLine}
      <div className="mt-7"><Link href={orderId ? `/orders/${orderId}` : "/orders"} className={primaryLink}>{orderId ? "Track Order" : "View my orders"}</Link></div>
    </>
  );

  if (state === "CANCELLED") return (
    <>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/5 text-2xl font-black" aria-hidden="true">×</div>
      <h1 aria-live="polite" className="mt-5 text-2xl font-black sm:text-3xl">Order cancelled</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">We removed these items from your cart. OPay didn’t complete this payment, so no order was placed. Whenever you need something again, we dey here.</p>
      <p className="mx-auto mt-3 max-w-sm text-xs leading-5 text-black/60">If money left your account anyway, contact support with this reference: <span className="break-all font-semibold">{reference}</span></p>
      <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Link href="/search" className={primaryLink}>Back to shopping</Link>
        <Link href="/support" className={secondaryLink}>Get help</Link>
      </div>
    </>
  );

  if (state === "FAILED") return (
    <>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl font-black text-red-800" aria-hidden="true">!</div>
      <h1 aria-live="polite" className="mt-5 text-2xl font-black sm:text-3xl">{PAYMENT_COPY.failedTitle}</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">Your order never confirm, so no order was placed. Your cart is still here — try again, or cancel this order if you no longer need am.</p>
      {noticeLine}
      {confirmingCancel ? cancelControls : (
        <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
          {actions.canRetry && <Link href="/checkout" className={primaryLink}>Try Again</Link>}
          {cancelControls}
        </div>
      )}
    </>
  );

  if (state === "SIGNED_OUT") return (
    <>
      <h1 aria-live="polite" className="text-2xl font-black sm:text-3xl">Log in to see your payment</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">Your session ended while you were paying. Log in again and we’ll pick up from here — please don’t pay again.</p>
      <div className="mt-7"><Link href={`/login?callbackUrl=${encodeURIComponent(`/checkout/payment-result?reference=${reference}`)}`} className={primaryLink}>Log in</Link></div>
    </>
  );

  const stuck = state === "REVIEW" || timedOut;
  return (
    <>
      {!stuck && <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-black motion-reduce:animate-none" aria-hidden="true" />}
      <h1 aria-live="polite" className="mt-5 text-2xl font-black sm:text-3xl">
        {state === "REVIEW" ? PAYMENT_COPY.reviewTitle : state === "PENDING" || timedOut ? PAYMENT_COPY.pendingTitle : PAYMENT_COPY.checkingTitle}
      </h1>
      <p role="status" aria-live="polite" className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">
        {state === "REVIEW"
          ? PAYMENT_COPY.reviewBody
          : timedOut
            ? PAYMENT_COPY.slowBody("we’ll create your order")
            : PAYMENT_COPY.checkingBody}
      </p>
      {stuck && <p className="mx-auto mt-3 max-w-sm break-all text-xs text-black/60">Payment reference: {reference}</p>}
      {noticeLine}
      {actions.canCancel && (confirmingCancel ? cancelControls : <div className="mt-6 flex justify-center">{cancelControls}</div>)}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => { setNotice(""); setState("CHECKING"); restart(); }} className={secondaryLink}>Check again</button>
        {stuck && <Link href="/orders" className={secondaryLink}>View my orders</Link>}
        {stuck && <Link href="/support" className={secondaryLink}>Get help</Link>}
      </div>
    </>
  );
}
