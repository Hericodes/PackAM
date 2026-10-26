import { auth } from "../../../../../auth";
import { canManageCatalogue } from "../../../../../lib/catalogue-permissions";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { IMPORT_MAX_BYTES } from "../../../../../lib/products/bulk-import";
import { importFileHash, importProducts, previewProductImport } from "../../../../../lib/products/bulk-import-server";

export const runtime = "nodejs";

/**
 * CSV product import. { mode: "preview", csv } checks every row and writes nothing.
 * { mode: "import", csv, fileHash } imports the ready rows of exactly that previewed file, all or nothing.
 * Admin-only; every check runs here on the server against the real categories and products.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !canManageCatalogue(session.user.role)) {
    return Response.json({ error: "Only PackAM admins can import products." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > IMPORT_MAX_BYTES * 2 + 10_000) {
    return Response.json({ error: "The file is too large. Import up to 1 MB at a time." }, { status: 413 });
  }

  let body: { mode?: unknown; csv?: unknown; fileHash?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const { mode, csv, fileHash } = body ?? {};
  if ((mode !== "preview" && mode !== "import") || typeof csv !== "string") return Response.json({ error: "Invalid request." }, { status: 400 });
  if (new TextEncoder().encode(csv).length > IMPORT_MAX_BYTES) return Response.json({ error: "The file is too large. Import up to 1 MB at a time." }, { status: 413 });

  const rate = await consumeRateLimit(`product-import-${mode}:${session.user.id}`, mode === "preview" ? 120 : 30, 60 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Too many imports. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  try {
    if (mode === "preview") {
      const preview = await previewProductImport(csv);
      if (!preview.ok) return Response.json({ error: preview.error }, { status: 400 });
      return Response.json({ ...preview, fileHash: importFileHash(csv) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (typeof fileHash !== "string" || !/^[0-9a-f]{64}$/.test(fileHash)) return Response.json({ error: "Preview the file before importing." }, { status: 400 });
    const result = await importProducts(session.user.id, csv, fileHash);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result, { status: result.created.length ? 201 : 200 });
  } catch (error) {
    console.error("PRODUCT IMPORT ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The import couldn’t be completed. Nothing was imported — try again." }, { status: 500 });
  }
}
