import { auth } from "../../../../../auth";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { cancelUnpaidPrintJob, printCancellationResponse } from "../../../../../lib/printing/print-cancellation";
import { printCancellationDeps } from "../../../../../lib/printing/print-cancellation-store";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

/** Cancels the signed-in student's own unpaid print job, after reconciling any pending payment with OPay. */
export async function POST(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only the student who owns this print job can cancel it here." }, { status: 403 });
  const rate = await consumeRateLimit(`print-cancel:${session.user.id}`, 10, 10 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Please wait a little before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const { id: printJobId } = await context.params;
  if (!printJobId || printJobId.length > 100) return Response.json({ error: "Print job not found." }, { status: 404 });

  try {
    const result = await cancelUnpaidPrintJob(printCancellationDeps(printJobId, { id: session.user.id, role: "STUDENT" }));
    const response = printCancellationResponse(result);
    return Response.json(response.body, { status: response.status });
  } catch (error) {
    console.error("PRINT JOB CANCEL ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t cancel this print job right now. Nothing has changed — please try again." }, { status: 500 });
  }
}
