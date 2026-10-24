import "server-only";

import { v2 as cloudinary } from "cloudinary";
import { MAX_PRODUCT_IMAGE_BYTES, PRODUCT_IMAGE_FOLDER, PRODUCT_IMAGE_FORMATS } from "./product-image";
import { checkStoredProductImage, type StoredImageLookup } from "./product-image-check";

function configureCloudinary() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new Error("IMAGE_STORAGE_NOT_CONFIGURED");
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return { cloudName, apiKey, apiSecret };
}

/**
 * Signed parameters for one direct browser upload. The server fixes the folder and the allowed formats,
 * and Cloudinary rejects an upload whose parameters don't match the signature, so the browser can't
 * upload elsewhere or another file type. The secret never leaves the server.
 */
export function createProductImageUploadCredentials() {
  const { cloudName, apiKey, apiSecret } = configureCloudinary();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { allowed_formats: PRODUCT_IMAGE_FORMATS.join(","), folder: PRODUCT_IMAGE_FOLDER, timestamp };
  return { cloudName, apiKey, timestamp, folder: params.folder, allowedFormats: params.allowed_formats, signature: cloudinary.utils.api_sign_request(params, apiSecret) };
}

const lookupWithAdminApi: StoredImageLookup = async (publicId) => {
  configureCloudinary();
  try {
    const resource: unknown = await cloudinary.api.resource(publicId, { resource_type: "image", type: "upload" });
    if (!resource || typeof resource !== "object") return null;
    const r = resource as Record<string, unknown>;
    return typeof r.format === "string" && typeof r.bytes === "number" ? { format: r.format, bytes: r.bytes } : null;
  } catch (error) {
    // Cloudinary answers a missing asset with HTTP 404; anything else is a storage problem, not "missing".
    const status = (error as { error?: { http_code?: number } })?.error?.http_code;
    if (status === 404) return null;
    throw error;
  }
};

/**
 * Confirms a new product image URL points at a real image uploaded to PackAM's Cloudinary before it
 * is saved, so a typo, a fake URL or an unfinished upload can never become a product photo.
 */
export function verifyProductImageForSave(url: string) {
  return checkStoredProductImage(url, { cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, lookup: lookupWithAdminApi, maxBytes: MAX_PRODUCT_IMAGE_BYTES });
}
