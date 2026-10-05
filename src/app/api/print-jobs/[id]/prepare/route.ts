import { auth } from "../../../../../auth";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { isRecordValue, parsePrintConfiguration } from "../../../../../lib/printing/input";
import { preparePrintJobForPayment } from "../../../../../lib/printing/service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to save your print settings." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Student access required." }, { status: 403 });
  const rate = await consumeRateLimit(`print-prepare:${session.user.id}`, 20, 60_000);
  if (!rate.allowed) return Response.json({ error: "Please wait before saving your print settings again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Choose valid print settings and a delivery location." }, { status: 400 }); }
  if (!isRecordValue(body) || typeof body.deliveryLocationId !== "string" || !body.deliveryLocationId) {
    return Response.json({ error: "Choose a saved delivery location before continuing." }, { status: 400 });
  }

  try {
    const configuration = parsePrintConfiguration(body.configuration);
    const { id } = await context.params;
    const result = await preparePrintJobForPayment(session.user.id, id, body.deliveryLocationId, configuration);
    return Response.json({ printJob: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/choose |enter |instructions|copies|pages|page numbers|upload|select|valid|delivery location/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    if (/print job not found|print job changed/i.test(message)) {
      return Response.json({ error: "Print job not found. Refresh the page and try again." }, { status: 404 });
    }
    console.error("PRINT JOB PREPARATION ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn't save your print settings. Please try again." }, { status: 500 });
  }
}
