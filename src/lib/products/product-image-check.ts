import { PRODUCT_IMAGE_FORMATS, parseProductImageUrl } from "./product-image";

export type StoredImageLookup = (publicId: string) => Promise<{ format: string; bytes: number } | null>;

export type StoredImageCheck = { ok: true } | { ok: false; status: 400 | 503; error: string };

/**
 * The save-time image check, with the Cloudinary lookup passed in so it is unit-tested without a network.
 * Product photos may live in any folder of PackAM's cloud (older ones predate the products folder), but
 * they must exist, be an image upload, and be an allowed format and size.
 */
export async function checkStoredProductImage(url: string, deps: { cloudName: string | undefined; lookup: StoredImageLookup; maxBytes: number }): Promise<StoredImageCheck> {
  const parsed = parseProductImageUrl(url, deps.cloudName);
  if (!parsed) return { ok: false, status: 400, error: "That image isn’t a PackAM product photo. Upload the image again." };
  let found: Awaited<ReturnType<StoredImageLookup>>;
  try {
    found = await deps.lookup(parsed.publicId);
  } catch (error) {
    if (error instanceof Error && error.message === "IMAGE_STORAGE_NOT_CONFIGURED") return { ok: false, status: 503, error: "Image storage isn’t configured, so the photo can’t be checked. Save without a photo or try again later." };
    return { ok: false, status: 503, error: "We couldn’t confirm the photo with image storage just now. Your other details are still here — try saving again." };
  }
  if (!found) return { ok: false, status: 400, error: "That photo isn’t in PackAM’s image storage (the upload may not have finished). Upload it again." };
  if (!(PRODUCT_IMAGE_FORMATS as readonly string[]).includes(found.format) || found.bytes <= 0 || found.bytes > deps.maxBytes) {
    return { ok: false, status: 400, error: "That photo isn’t an allowed format or size. Upload a JPG, PNG or WebP up to 5 MB." };
  }
  return { ok: true };
}
