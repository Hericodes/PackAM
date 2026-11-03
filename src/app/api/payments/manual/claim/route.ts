import { auth } from "../../../../../auth";
import { claimManualTransfer } from "../../../../../lib/payments/manual-transfer-store";
import { consolePaymentLogger, referenceTail } from "../../../../../lib/payments/opay-verification";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

/**
 * "I've made the payment" on a bank-transfer checkout. Records the student's claim and alerts the admins; it never
 * marks anything paid (only an admin confirming the credit does).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only students can pay for a PackAM order." }, { status: 403 });
  const rate = await consumeRateLimit(`manual-claim:${session.user.id}`, 10, 10 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Please wait a little before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Payment reference is invalid." }, { status: 400 }); }
  const reference = body && typeof body === "object" && "reference" in body ? (body as { reference?: unknown }).reference : undefined;
  if (typeof reference !== "string" || !reference || reference.length > 100) return Response.json({ error: "Payment reference is invalid." }, { status: 400 });

  try {
    const result = await claimManualTransfer(session.user.id, reference);
    consolePaymentLogger.info("manual_transfer_claim", { refTail: referenceTail(reference), status: result.status });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    consolePaymentLogger.error("manual_transfer_claim_failed", { refTail: referenceTail(reference), errorName: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "We couldn’t record that right now. Nothing has changed — please try again." }, { status: 500 });
  }
}
