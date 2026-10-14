import { auth } from "../../../../../../auth";
import { consumeRateLimit } from "../../../../../../lib/rate-limit";
import { authorizePrintDocumentAccess, PrintMissionError } from "../../../../../../lib/printing/runner-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Streams the PDF through PackAM so the short-lived Cloudinary URL never reaches the browser.
 * Authorization is re-checked on every request against the accepted assignment.
 */
export async function GET(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: privateHeaders });
  if (session.user.role !== "RUNNER") return Response.json({ error: "Runner access required." }, { status: 403, headers: privateHeaders });
  const rate = await consumeRateLimit(`runner-print-document:${session.user.id}`, 10, 10 * 60_000);
  if (!rate.allowed) {
    return Response.json({ error: "Too many downloads. Try again shortly." }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const { id } = await context.params;

  try {
    const access = await authorizePrintDocumentAccess(session.user.id, id);
    const upstream = await fetch(access.url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "The document couldn’t be loaded. Try again or report it as unreadable." }, { status: 502, headers: privateHeaders });
    }
    const fileName = access.fileName.replace(/["\\\r\n]/g, "_");
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(access.fileName)}`,
        ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length")! } : {}),
      },
    });
  } catch (error) {
    if (error instanceof PrintMissionError) return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    console.error("RUNNER PRINT DOCUMENT ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The document couldn’t be loaded. Try again shortly." }, { status: 503, headers: privateHeaders });
  }
}
