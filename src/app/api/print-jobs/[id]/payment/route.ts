import { PaymentProvider } from "@prisma/client";
import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { createPrintPaymentAttempt } from "../../../../../lib/printing/service";
import { parsePrintCheckoutSnapshot } from "../../../../../lib/printing/payment-snapshot";
import { createCashierPayment } from "../../../../../lib/payments/providers/opay";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue to payment." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only students can pay for print jobs." }, { status: 403 });
  const rate = await consumeRateLimit(`print-payment-create:${session.user.id}`, 5, 10 * 60 * 1000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Please wait a little before trying payment again." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id: printJobId } = await context.params;
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey) return Response.json({ error: "Payment request key is missing. Please try again." }, { status: 400 });

  try {
    const attempt = await createPrintPaymentAttempt(PaymentProvider.OPAY, session.user.id, printJobId, idempotencyKey);
    if (attempt.provider !== PaymentProvider.OPAY || attempt.printJobId !== printJobId) {
      throw new Error("Print payment attempt did not match the requested job.");
    }
    if (!attempt.transactionReference) throw new Error("Print payment attempt has no reference.");

    const stored = await db.payment.findFirst({
      where: { transactionReference: attempt.transactionReference, userId: session.user.id, printJobId },
      select: {
        status: true,
        amount: true,
        currency: true,
        cashierUrl: true,
        providerCheckoutReference: true,
        checkoutSnapshot: true,
      },
    });
    if (!stored) throw new Error("Print payment attempt could not be loaded.");
    // A cancelled job must never be handed a checkout link, even for an attempt created before it was cancelled.
    const job = await db.printJob.findFirst({ where: { id: printJobId, userId: session.user.id }, select: { status: true } });
    if (job?.status === "CANCELLED") {
      return Response.json({ error: "This print job was cancelled, so it can’t be paid for. Start a new print job instead." }, { status: 409 });
    }
    const resultUrl = `/printing/payment/${encodeURIComponent(printJobId)}`;
    if (stored.status === "SUCCESS" || stored.status === "FAILED" || stored.status === "RECONCILIATION_REQUIRED") {
      return Response.json({ resultUrl });
    }
    if (stored.cashierUrl) return Response.json({ cashierUrl: stored.cashierUrl, resultUrl });

    const [student, appUrl] = await Promise.all([
      db.user.findFirst({
        where: { id: session.user.id, role: "STUDENT", status: "ACTIVE" },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      }),
      Promise.resolve(process.env.APP_URL),
    ]);
    if (!student) throw new Error("Active student account not found.");
    if (!appUrl) throw new Error("APP_URL is required for OPay return and callback URLs.");
    const baseUrl = new URL(appUrl);
    if (baseUrl.protocol !== "https:" && process.env.NODE_ENV === "production") {
      throw new Error("APP_URL must use HTTPS in production.");
    }
    const snapshot = parsePrintCheckoutSnapshot(stored.checkoutSnapshot);
    if (snapshot.printJobId !== printJobId || stored.amount !== snapshot.total || stored.currency !== snapshot.currency) {
      throw new Error("Print payment does not match the prepared print-job snapshot.");
    }

    const reference = attempt.transactionReference;
    const result = await createCashierPayment({
      reference,
      amount: stored.amount,
      productName: "PackAM printing",
      productDescription: `${snapshot.documentName} · ${snapshot.selectedPageCount} pages · ${snapshot.copies} ${snapshot.copies === 1 ? "copy" : "copies"}`,
      customer: {
        id: student.id,
        name: [student.firstName, student.lastName].filter(Boolean).join(" "),
        email: student.email,
        phone: student.phone ?? undefined,
      },
      returnUrl: new URL(resultUrl, baseUrl).toString(),
      cancelUrl: new URL(resultUrl, baseUrl).toString(),
      callbackUrl: new URL("/api/webhooks/opay", baseUrl).toString(),
    });

    const saved = await db.payment.updateMany({
      where: { transactionReference: reference, userId: student.id, printJobId, status: "PENDING", cashierUrl: null },
      data: { cashierUrl: result.cashierUrl, providerCheckoutReference: result.providerCheckoutReference },
    });
    if (saved.count !== 1) {
      const current = await db.payment.findFirst({
        where: { transactionReference: reference, userId: student.id, printJobId },
        select: { cashierUrl: true, status: true },
      });
      if (current?.cashierUrl) return Response.json({ cashierUrl: current.cashierUrl, resultUrl });
      if (current?.status === "SUCCESS" || current?.status === "FAILED" || current?.status === "RECONCILIATION_REQUIRED") {
        return Response.json({ resultUrl });
      }
      throw new Error("OPay checkout details could not be saved.");
    }
    return Response.json({ cashierUrl: result.cashierUrl, resultUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/not ready for payment|saved delivery location|active student|print job not found|already pending|request key/i.test(message)) {
      return Response.json({ error: message }, { status: 409 });
    }
    console.error("PRINT OPAY PAYMENT CREATE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json(
      { error: "Payment couldn’t be started. Your print job is still safe — try again." },
      { status: 503 },
    );
  }
}
