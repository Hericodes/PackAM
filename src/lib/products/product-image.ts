/**
 * Product photo rules shared by the admin uploader (browser) and the products API (server). Pure, so
 * the file checks, the Cloudinary response check and URL parsing are all unit-tested.
 */

/** Every product photo is uploaded into this Cloudinary folder; the signing route only signs for it. */
export const PRODUCT_IMAGE_FOLDER = "packam/products";
/** Cloudinary format names. JPEG files report "jpg". */
export const PRODUCT_IMAGE_FORMATS = ["jpg", "png", "webp"] as const;
export const PRODUCT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Same 5 MB limit the previous upload widget enforced. */
export const MAX_PRODUCT_IMAGE_BYTES = 5_000_000;
export const PRODUCT_IMAGE_HINT = "JPG, PNG or WebP · up to 5 MB";

/** Why this file can't be a product photo, or null when it can. Checked before anything is uploaded. */
export function productImageFileProblem(file: { type: string; size: number; name: string }) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const typeOk = (PRODUCT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
  // Some phones send no MIME type; then the file extension decides.
  const extensionOk = ["jpg", "jpeg", "png", "webp"].includes(extension);
  if (!(typeOk || (!file.type && extensionOk))) return "That file isn’t a JPG, PNG or WebP image. Choose a photo in one of those formats.";
  if (file.size <= 0) return "That image file is empty. Choose another photo.";
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) return `That image is ${(file.size / 1_000_000).toFixed(1)} MB. Choose one up to 5 MB, or resize it first.`;
  return null;
}

/**
 * Checks Cloudinary's answer to a direct upload before its URL is used: it must be an image in the
 * product folder, in an allowed format, from this cloud. Returns the URL to store, or why not.
 */
export function verifiedUploadUrl(result: unknown, cloudName: string): { ok: true; url: string } | { ok: false; reason: string } {
  const fail = { ok: false as const, reason: "The upload couldn’t be confirmed. Try again." };
  if (!result || typeof result !== "object") return fail;
  const r = result as Record<string, unknown>;
  if (r.resource_type !== "image" || r.type !== "upload") return fail;
  if (typeof r.public_id !== "string" || !r.public_id.startsWith(`${PRODUCT_IMAGE_FOLDER}/`)) return fail;
  if (typeof r.format !== "string" || !(PRODUCT_IMAGE_FORMATS as readonly string[]).includes(r.format)) return fail;
  if (typeof r.bytes !== "number" || r.bytes <= 0 || r.bytes > MAX_PRODUCT_IMAGE_BYTES) return fail;
  if (typeof r.secure_url !== "string") return fail;
  const parsed = parseProductImageUrl(r.secure_url, cloudName);
  if (!parsed || parsed.publicId !== r.public_id) return fail;
  return { ok: true, url: r.secure_url };
}

/**
 * The Cloudinary public id inside a stored product image URL, e.g.
 * https://res.cloudinary.com/<cloud>/image/upload/v1712345/packam/products/abc.jpg → packam/products/abc.
 * Null for anything that isn't an image upload in this cloud.
 */
export function parseProductImageUrl(value: string, cloudName: string | undefined): { publicId: string; format: string } | null {
  if (!cloudName || value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.search || url.hash) return null;
  const prefix = `/${cloudName}/image/upload/`;
  if (!url.pathname.startsWith(prefix)) return null;
  const segments = url.pathname.slice(prefix.length).split("/").filter(Boolean);
  // Drop any transformation segments ("c_limit,w_1600") and the version ("v1712345").
  while (segments.length > 1 && (/^v\d+$/.test(segments[0]) || /^[a-z]{1,3}_[^/]*$/i.test(segments[0]))) segments.shift();
  const last = segments.pop();
  const dot = last?.lastIndexOf(".") ?? -1;
  if (!last || dot <= 0) return null;
  const format = last.slice(dot + 1).toLowerCase();
  let publicId: string;
  try { publicId = decodeURIComponent([...segments, last.slice(0, dot)].join("/")); } catch { return null; }
  if (!publicId || publicId.includes("..")) return null;
  return { publicId, format };
}
