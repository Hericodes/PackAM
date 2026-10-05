import { auth } from "../../../../auth";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { createPrintDocumentReplacementDraft, createPrintUploadDraft, resumePrintUploadDraft } from "../../../../lib/printing/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to upload a print document." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Only students can create print jobs." }, { status: 403 });
  const rate = await consumeRateLimit(`print-upload:${session.user.id}`, 10, 60 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Upload limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  try {
    let body: unknown = null;
    try { body = await request.json(); } catch { /* Empty request body starts or resumes a draft. */ }
    const replacePrintJobId = body && typeof body === "object" && "replacePrintJobId" in body
      ? (body as { replacePrintJobId?: unknown }).replacePrintJobId
      : undefined;
    const resumePrintJobId = body && typeof body === "object" && "resumePrintJobId" in body
      ? (body as { resumePrintJobId?: unknown }).resumePrintJobId
      : undefined;
    if (replacePrintJobId !== undefined && (typeof replacePrintJobId !== "string" || !replacePrintJobId)) {
      return Response.json({ error: "Choose a valid document to replace." }, { status: 400 });
    }
    if (resumePrintJobId !== undefined && (typeof resumePrintJobId !== "string" || !resumePrintJobId)) {
      return Response.json({ error: "This print upload can no longer be resumed." }, { status: 400 });
    }
    if (typeof resumePrintJobId === "string" && typeof replacePrintJobId === "string") {
      return Response.json({ error: "Choose either a new upload or a replacement." }, { status: 400 });
    }
    const result = typeof resumePrintJobId === "string"
      ? await resumePrintUploadDraft(session.user.id, resumePrintJobId)
      : typeof replacePrintJobId === "string"
        ? await createPrintDocumentReplacementDraft(session.user.id, replacePrintJobId)
        : await createPrintUploadDraft(session.user.id);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/cannot be replaced|could no longer be replaced|no longer be available/i.test(message)) {
      return Response.json({ error: message }, { status: 409 });
    }
    console.error("PRINT UPLOAD SIGNATURE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({
      error: /storage is not configured|student account/i.test(message)
        ? message
        : "Secure document upload is temporarily unavailable. Please try again.",
    }, { status: /storage is not configured/i.test(message) ? 503 : 500 });
  }
}
