"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { usePaymentPolling } from "../payments/usePaymentPolling";

type PaymentState = "CHECKING" | "PENDING" | "SUCCESS" | "FAILED" | "REVIEW" | "SIGNED_OUT" | "ERROR";

const primaryLink = "mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto";
const secondaryLink = "inline-flex min-h-11 items-center justify-center px-3 text-sm font-bold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

export function PaymentResultClient({ reference }: { reference: string }) {
  const [state, setState] = useState<PaymentState>("CHECKING");
  const [orderId, setOrderId] = useState<string | null>(null);

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
        setState("FAILED");
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

  if (state === "SUCCESS") return (
    <>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl font-black text-green-800" aria-hidden="true">✓</div>
      <h1 aria-live="polite" className="mt-5 text-2xl font-black sm:text-3xl">Payment confirmed 🎉</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">Your order is in. We’re finding a runner to bring your stuff.</p>
      <Link href={orderId ? `/orders/${orderId}` : "/orders"} className={primaryLink}>{orderId ? "Track your order" : "View my orders"}</Link>
    </>
  );

  if (state === "FAILED") return (
    <>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl font-black text-red-800" aria-hidden="true">!</div>
      <h1 aria-live="polite" className="mt-5 text-2xl font-black sm:text-3xl">Payment wasn’t completed</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">No order was placed. Your cart is still here whenever you’re ready to try again.</p>
      <Link href="/checkout" className={primaryLink}>Back to checkout</Link>
    </>
  );

  if (state === "SIGNED_OUT") return (
    <>
      <h1 aria-live="polite" className="text-2xl font-black sm:text-3xl">Log in to see your payment</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">Your session ended while you were paying. Log in again and we’ll pick up from here — please don’t pay again.</p>
      <Link href={`/login?callbackUrl=${encodeURIComponent(`/checkout/payment-result?reference=${reference}`)}`} className={primaryLink}>Log in</Link>
    </>
  );

  const stuck = state === "REVIEW" || timedOut;
  return (
    <>
      {!stuck && <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-black motion-reduce:animate-none" aria-hidden="true" />}
      <h1 aria-live="polite" className="mt-5 text-2xl font-black sm:text-3xl">
        {state === "REVIEW" ? "We’re checking this payment" : timedOut ? "This is taking longer than usual" : "Confirming your payment…"}
      </h1>
      <p role="status" aria-live="polite" className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/70">
        {state === "REVIEW"
          ? "Our team needs to confirm this payment by hand. Please don’t pay again — if money left your account, it’s safe, and we’ll update your orders."
          : timedOut
            ? "Please don’t pay again. If money left your account, it’s safe — we’ll create your order as soon as OPay confirms it."
            : "We’re confirming with OPay. This usually takes under a minute — please don’t pay again."}
      </p>
      {stuck && <p className="mx-auto mt-3 max-w-sm break-all text-xs text-black/60">Payment reference: {reference}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => { setState("CHECKING"); restart(); }} className={secondaryLink}>Check again</button>
        {stuck && <Link href="/orders" className={secondaryLink}>View my orders</Link>}
        {stuck && <Link href="/support" className={secondaryLink}>Get help</Link>}
      </div>
    </>
  );
}
