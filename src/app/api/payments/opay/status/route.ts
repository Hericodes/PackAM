import { PaymentProvider } from "@prisma/client";
import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { isCheckoutCancelled, opayStatusDeps } from "../../../../../lib/payments/checkout-cancellation-store";
import { checkOpayPaymentStatus, consolePaymentLogger } from "../../../../../lib/payments/opay-verification";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "STUDENT") return Response.json({ error: "Sign in to check payment." }, { status: 401 });
  const rate = await consumeRateLimit(`opay-status:${session.user.id}`, 15, 60_000);
  if (!rate.allowed) return Response.json({ error: "Please wait before checking again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const query = new URL(request.url).searchParams;
  const reference = query.get("reference");
  const printJobId = query.get("printJobId");
  if (!reference || reference.length > 100) return Response.json({ error: "Payment reference is invalid." }, { status: 400 });
  if (printJobId !== null && (!printJobId || printJobId.length > 100)) return Response.json({ error: "Print job reference is invalid." }, { status: 400 });

  let attempt;
  try {
    attempt = await db.payment.findFirst({
      where: {
        transactionReference: reference,
        userId: session.user.id,
        provider: PaymentProvider.OPAY,
        ...(printJobId ? { printJobId } : {}),
      },
      select: { id: true, providerCheckoutReference: true, amount: true, currency: true, status: true, orderId: true, printJobId: true },
    });
  } catch (error) {
    consolePaymentLogger.warn("opay_status_lookup_failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "We’re still confirming your payment. Please check again shortly." }, { status: 503 });
  }
  if (!attempt) return Response.json({ error: "Payment attempt not found." }, { status: 404 });
  if (attempt.status === "SUCCESS") return Response.json({ status: "SUCCESS", orderId: attempt.orderId, printJobId: attempt.printJobId });
  if (attempt.status === "FAILED") {
    const cancelled = !attempt.printJobId && await isCheckoutCancelled(attempt.id).catch(() => false);
    return Response.json({ status: "FAILED", cancelled });
  }

  const result = await checkOpayPaymentStatus(
    { reference, amount: attempt.amount, currency: attempt.currency, providerCheckoutReference: attempt.providerCheckoutReference },
    opayStatusDeps,
  );
  return Response.json(result.body, { status: result.status });
}
