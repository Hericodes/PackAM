import { auth } from "../../../../../auth";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { completePrintDocumentUpload } from "../../../../../lib/printing/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to finish this upload." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Student access required." }, { status: 403 });
  const rate = await consumeRateLimit(`print-upload-complete:${session.user.id}`, 20, 60 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Please wait before verifying another upload." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const { id } = await context.params;
  try {
    let body: unknown = null;
    try { body = await request.json(); } catch { /* Normal uploads do not replace an existing document. */ }
    const replacesPrintJobId = body && typeof body === "object" && "replacesPrintJobId" in body
      ? (body as { replacesPrintJobId?: unknown }).replacesPrintJobId
      : undefined;
    if (replacesPrintJobId !== undefined && (typeof replacesPrintJobId !== "string" || !replacesPrintJobId)) {
      return Response.json({ error: "The document replacement request is invalid." }, { status: 400 });
    }
    const document = await completePrintDocumentUpload(session.user.id, id, typeof replacesPrintJobId === "string" ? replacesPrintJobId : null);
    return Response.json({ document }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const expected = /upload|PDF|pdf|file|page|document|password|damaged|expired|verify|integrity|15MB|between 1 and|replace|payment attempt/i.test(message);
    if (!expected) console.error("PRINT DOCUMENT VALIDATION ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({
      error: expected ? message : "We couldn't verify this PDF with secure storage. Try uploading it again.",
    }, { status: expected ? 400 : 502 });
  }
}
