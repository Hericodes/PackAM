import { auth } from "../../../../auth";
import { canManageCatalogue } from "../../../../lib/catalogue-permissions";
import { consumeRateLimit } from "../../../../lib/rate-limit";
import { createProductImageUploadCredentials } from "../../../../lib/products/product-image-server";

export const runtime = "nodejs";

/**
 * Signed credentials for one product photo upload, straight from the admin's browser to Cloudinary.
 * Admin-only and rate limited; the server picks every signed parameter, so nothing the browser sends
 * is signed. Uploading alone changes no product: the photo is attached only when the product is saved,
 * after the products API has confirmed the image exists.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user || !canManageCatalogue(session.user.role)) {
    return Response.json({ error: "Only PackAM admins can upload product images." }, { status: 403 });
  }
  const rate = await consumeRateLimit(`product-image-upload:${session.user.id}`, 60, 60 * 60 * 1000);
  if (!rate.allowed) return Response.json({ error: "Upload limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  try {
    return Response.json(createProductImageUploadCredentials(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "IMAGE_STORAGE_NOT_CONFIGURED") {
      return Response.json({ error: "Image storage isn’t configured. You can still save the product without a photo." }, { status: 503 });
    }
    console.error("PRODUCT IMAGE SIGNATURE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Image upload is temporarily unavailable. Please try again." }, { status: 500 });
  }
}
