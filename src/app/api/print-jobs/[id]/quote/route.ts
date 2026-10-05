import { auth } from "../../../../../auth";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { isRecordValue, parsePrintConfiguration } from "../../../../../lib/printing/input";
import { quotePrintJob } from "../../../../../lib/printing/service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to price this print job." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Student access required." }, { status: 403 });
  const rate = await consumeRateLimit(`print-quote:${session.user.id}`, 60, 60_000);
  if (!rate.allowed) return Response.json({ error: "Please wait before requesting another price." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Choose valid print settings." }, { status: 400 }); }
  try {
    const configuration = parsePrintConfiguration(isRecordValue(body) ? body.configuration : undefined);
    const { id } = await context.params;
    const quote = await quotePrintJob(session.user.id, id, configuration);
    return Response.json({ quote }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/choose |enter |instructions|copies|pages|page numbers|upload|select|valid/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    if (/Print job not found|print job changed/i.test(message)) return Response.json({ error: "Print job not found." }, { status: 404 });
    console.error("PRINT QUOTE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn't calculate that print price." }, { status: 500 });
  }
}
