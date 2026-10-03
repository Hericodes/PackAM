"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type PaymentState = "CHECKING" | "PENDING" | "SUCCESS" | "FAILED" | "ERROR";

export function PaymentResultClient({ reference }: { reference: string }) {
  const [state, setState] = useState<PaymentState>("CHECKING");
  const [orderId, setOrderId] = useState<string | null>(null);

  const checkPayment = useCallback(async (): Promise<PaymentState> => {
    try {
      const response = await fetch(`/api/payments/opay/status?reference=${encodeURIComponent(reference)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error("Payment status is not available yet.");
      const nextState = data.status === "SUCCESS" ? "SUCCESS" : data.status === "FAILED" ? "FAILED" : "PENDING";
      if (nextState === "SUCCESS" && typeof data.orderId === "string") setOrderId(data.orderId);
      setState(nextState);
      return nextState;
    } catch {
      setState((current) => current === "CHECKING" ? "ERROR" : current);
      return "ERROR";
    }
  }, [reference]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await checkPayment();
      if (!stopped && result !== "SUCCESS" && result !== "FAILED") timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [checkPayment]);

  if (state === "SUCCESS") return (
    <>
      <p className="text-4xl" aria-hidden="true">✓</p>
      <h1 className="mt-4 text-2xl font-black">Payment confirmed</h1>
      <p className="mt-3 text-black/65">Your order has been placed. We’re finding someone to bring your stuff. 🫡</p>
      {orderId && <Link href={`/orders/${orderId}`} className="mt-7 inline-flex rounded-full bg-black px-6 py-3 text-sm font-black text-white">View your order</Link>}
    </>
  );

  if (state === "FAILED") return (
    <>
      <h1 className="text-2xl font-black">Payment wasn’t completed</h1>
      <p className="mt-3 text-black/65">Your cart is still here. You can try again whenever you’re ready.</p>
      <Link href="/checkout" className="mt-7 inline-flex rounded-full bg-black px-6 py-3 text-sm font-black text-white">Back to checkout</Link>
    </>
  );

  return (
    <>
      <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-black/10 border-t-black" aria-hidden="true" />
      <h1 className="mt-5 text-2xl font-black">{state === "ERROR" ? "We’re still confirming your payment…" : state === "PENDING" ? "We’re still confirming your payment…" : "Payment processing…"}</h1>
      <p role="status" className="mt-3 text-sm text-black/60">We’ll update your order as soon as OPay confirms it.</p>
      <button type="button" onClick={() => { setState("CHECKING"); void checkPayment(); }} className="mt-6 text-sm font-bold underline underline-offset-4">Check again</button>
    </>
  );
}
