import { auth } from "../../../../../auth";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { adminRetryPrintJob, adminStartPrintRefund } from "../../../../../lib/printing/fulfilment-recovery";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-print-job:${session.user.id}`, 20, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid print job action." }, { status: 400 }); }
  const action = body && typeof body === "object" && !Array.isArray(body) ? (body as { action?: unknown }).action : undefined;
  try {
    if (action === "retry") return Response.json(await adminRetryPrintJob(session.user.id, id));
    if (action === "refund") return Response.json(await adminStartPrintRefund(session.user.id, id));
    return Response.json({ error: "Choose retry or refund." }, { status: 400 });
  } catch (error) {
    console.error("ADMIN PRINT JOB ACTION ERROR:", error instanceof Error ? error.name : "Unknown error");
    // Database errors carry query text and file paths; never forward them.
    if (error instanceof Error && error.name.startsWith("PrismaClient")) {
      return Response.json({ error: "This print job just changed. Refresh and try again." }, { status: 409 });
    }
    const message = error instanceof Error && /print job|retried|runner|assignment|captured payment|cannot move|status changed/i.test(error.message)
      ? error.message
      : "This print job could not be updated.";
    return Response.json({ error: message }, { status: 409 });
  }
}
