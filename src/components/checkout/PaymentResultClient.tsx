"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { usePaymentPolling } from "../payments/usePaymentPolling";
import { checkoutPaymentActions } from "../../lib/payments/checkout-cancellation";
import { PAYMENT_COPY } from "../../lib/student-copy";
import { providerName } from "../../lib/payments/provider-selection";
import type { ManualTransferView } from "../../lib/payments/manual-transfer";

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
  const [provider, setProvider] = useState<string | null>(null);
  const [manual, setManual] = useState<ManualTransferView | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const payWith = providerName(provider);

  const checkPayment = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/payments/status?reference=${encodeURIComponent(reference)}`, { cache: "no-store" });
      if (response.status === 401) {
        setState("SIGNED_OUT");
        return false;
      }
      const data = await response.json();
      if (typeof data.provider === "string") setProvider(data.provider);
      if (data.manual && typeof data.manual === "object") setManual(data.manual as ManualTransferView);
      if (!response.ok) throw new Error("Payment status is not available yet.");
      if (data.status === "SUCCESS") {
        if (typeof data.orderId === "string") setOrderId(data.orderId);
        setState("SUCCESS");
        return false;
      }
      if (data.status === "FAILED") {
        if (data.expired === true) setExpired(true);
        setState(data.cancelled === true ? "CANCELLED" : "FAILED");
        return false;
      }
      if (data.status === "RECONCILIATION_REQUIRED") {
        // Keep re-checking: the status route re-verifies with the provider and can still complete it.
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
      const response = await fetch("/api/payments/cancel", {
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

  /** "I've made the payment": a claim only. An admin confirming the credit is what creates the order. */
  async function claimPayment() {
    if (claimBusy) return;
    setClaimBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/payments/manual/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      });
      if (response.status === 401) {
        setState("SIGNED_OUT");
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(typeof data.error === "string" ? data.error : "We couldn’t record that right now. Nothing has changed — please try again.");
        return;
      }
      if (data.status === "SUCCESS") {
        if (typeof data.orderId === "string") setOrderId(data.orderId);
        setState("SUCCESS");
      } else if (data.status === "FAILED") {
        setState("FAILED");
      } else {
        setManual((current) => current && { ...current, claimed: true });
        restart();
      }
    } catch {
      setNotice("We couldn’t reach PackAM. Nothing has changed — please try again.");
    } finally {
      setClaimBusy(false);
    }
  }

  async function copyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
    } catch {
      setNotice("Copy didn’t work on this phone. Please type the details in by hand.");
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
            ? `${payWith} didn’t complete this payment, so no order was placed. Cancelling removes these items from your cart.`
            : manual
              ? "This removes your unpaid order from checkout. Only cancel if you haven’t sent any money."
              : `We’ll check with ${payWith} first. If your payment has gone through, your order stays and won’t be cancelled. If it’s still being confirmed, nothing changes yet.`}
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
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">We removed these items from your cart. {payWith} didn’t complete this payment, so no order was placed. Whenever you need something again, we dey here.</p>
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
      <h1 aria-live="polite" className="mt-5 text-2xl font-black sm:text-3xl">{expired ? "Time ran out for this transfer" : PAYMENT_COPY.failedTitle}</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">{expired
        ? "We didn’t hear that you sent the money within 30 minutes, so no order was placed. Your cart is still here — check out again to get a fresh code. If you did send money, contact support with your transfer code."
        : "Your order never confirm, so no order was placed. Your cart is still here — try again, or cancel this order if you no longer need am."}</p>
      {noticeLine}
      {confirmingCancel ? cancelControls : (
        <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
          {actions.canRetry && <Link href="/cart" className={primaryLink}>Try Again</Link>}
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

  if (manual && state === "PENDING") {
    const rows: { key: string; label: string; value: string; display?: string }[] = [
      { key: "amount", label: "Amount to send", value: String(manual.amount), display: `₦${manual.amount.toLocaleString()}` },
      { key: "bank", label: "Bank", value: manual.bankName },
      { key: "account", label: "Account number", value: manual.accountNumber },
      { key: "name", label: "Account name", value: manual.accountName },
      { key: "code", label: "Put this in the remark", value: manual.code },
    ];
    return (
      <>
        {manual.claimed
          ? <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-black motion-reduce:animate-none" aria-hidden="true" />
          : <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4c7] text-2xl font-black" aria-hidden="true">₦</div>}
        <h1 aria-live="polite" className="mt-5 text-2xl font-black sm:text-3xl">{manual.claimed ? "We’re checking your transfer" : "Pay by bank transfer"}</h1>
        <p role="status" aria-live="polite" className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">
          {manual.claimed
            ? "Thanks! We’re confirming your money now. This usually takes a few minutes. You can leave this page — we’ll tell you the moment your order is confirmed. Please don’t pay again."
            : `Send the exact amount below from your bank app by ${new Date(manual.payBy).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" })} (30 minutes), then come back and tap “I’ve made the payment”.`}
        </p>
        <dl className="mx-auto mt-5 max-w-sm divide-y divide-black/5 rounded-2xl border border-black/10 bg-[#fffdf7] text-left">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <dt className="text-xs font-semibold text-black/55">{row.label}</dt>
                <dd className="break-words text-base font-black">{row.display ?? row.value}</dd>
              </div>
              <button type="button" onClick={() => void copyValue(row.key, row.value)} aria-label={`Copy ${row.label.toLowerCase()}`} className="min-h-10 shrink-0 rounded-full border border-black/15 bg-white px-3 text-xs font-black transition hover:border-black/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
                {copied === row.key ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
        </dl>
        <p className="mx-auto mt-3 max-w-sm text-xs leading-5 text-black/60">Send exactly ₦{manual.amount.toLocaleString()}, no more and no less. The code in the remark helps us find your payment fast.</p>
        {noticeLine}
        {!manual.claimed && (
          <div className="mx-auto mt-6 max-w-sm">
            <button type="button" onClick={() => void claimPayment()} disabled={claimBusy} aria-busy={claimBusy} className={`${primaryLink} w-full disabled:cursor-wait disabled:opacity-60 sm:w-full`}>
              {claimBusy ? "One moment…" : "I’ve made the payment"}
            </button>
            <p className="mt-2 text-xs leading-5 text-black/55">Only tap this after your money has left your account.</p>
          </div>
        )}
        {manual.claimed && timedOut && <p className="mx-auto mt-4 max-w-sm break-all text-xs text-black/60">Still waiting? Payment reference: {reference}</p>}
        {!manual.claimed && actions.canCancel && (confirmingCancel ? cancelControls : <div className="mt-4 flex justify-center">{cancelControls}</div>)}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => { setNotice(""); restart(); }} className={secondaryLink}>Check again</button>
          {manual.claimed && <Link href="/orders" className={secondaryLink}>View my orders</Link>}
          {manual.claimed && <Link href="/support" className={secondaryLink}>Get help</Link>}
        </div>
      </>
    );
  }

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
