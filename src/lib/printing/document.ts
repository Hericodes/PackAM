import "server-only";

import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { MAX_PRINT_DOCUMENT_BYTES } from "./upload-validation";
import {
  getPdfPageCount,
  validateDownloadedPrintPdf,
  validatePrivatePrintAsset,
  type PrintUploadIdentity,
} from "./document-validation";

export { MAX_PRINT_DOCUMENT_BYTES };
export { getPdfPageCount };
const PRINT_DOCUMENT_FOLDER = "packam/print-jobs";

function configureCloudinary() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Secure document storage is not configured. Contact PackAM support.");
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return { cloudName, apiKey, apiSecret };
}

export function sanitizePrintFileName(name: string) {
  const sanitized = name
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 180);
  if (!sanitized || !/\.pdf$/i.test(sanitized)) {
    throw new Error("Upload a PDF document.");
  }
  return sanitized;
}

export function createPrintUploadCredentials(printJobId: string) {
  const { cloudName, apiKey, apiSecret } = configureCloudinary();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = PRINT_DOCUMENT_FOLDER;
  const publicId = `${printJobId}.pdf`;
  const type = "authenticated";
  const params = { folder, overwrite: true, public_id: publicId, timestamp, type, unique_filename: false };
  return {
    apiKey,
    cloudName,
    folder,
    publicId,
    resourceType: "raw" as const,
    signature: cloudinary.utils.api_sign_request(params, apiSecret),
    timestamp,
    type,
  };
}

type VerifiedCloudinaryAsset = {
  publicId: string;
  assetId: string;
  version: number;
  originalFileName: string;
  fileSize: number;
  pageCount: number;
  bytes: Uint8Array;
};

export async function deleteCloudinaryAssetById(assetId: string) {
  configureCloudinary();
  const result: unknown = await cloudinary.api.delete_resources_by_asset_ids([assetId]);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Cloudinary did not confirm deletion of the invalid print asset.");
  }
  const deleted = (result as Record<string, unknown>).deleted;
  if (!deleted || typeof deleted !== "object" || Array.isArray(deleted)) {
    throw new Error("Cloudinary did not confirm deletion of the invalid print asset.");
  }
  const status = (deleted as Record<string, unknown>)[assetId];
  if (status !== "deleted" && status !== "not_found") {
    throw new Error("Cloudinary did not confirm deletion of the invalid print asset.");
  }
}

export async function downloadAndValidatePrintDocument(
  printJobId: string,
  expectedIdentity: PrintUploadIdentity,
): Promise<VerifiedCloudinaryAsset> {
  configureCloudinary();
  const publicId = `${PRINT_DOCUMENT_FOLDER}/${printJobId}.pdf`;
  let deleteAssetId: string | null = null;
  try {
    const assetValue: unknown = await cloudinary.api.resource(publicId, {
      resource_type: "raw",
      type: "authenticated",
      context: false,
    });
    if (assetValue && typeof assetValue === "object" && !Array.isArray(assetValue)) {
      const asset = assetValue as Record<string, unknown>;
      if (
        asset.public_id === publicId &&
        asset.asset_id === expectedIdentity.assetId &&
        asset.version === expectedIdentity.version
      ) {
        deleteAssetId = expectedIdentity.assetId;
      }
    }
    const asset = validatePrivatePrintAsset(assetValue, publicId, expectedIdentity);
    const downloadUrl = cloudinary.utils.private_download_url(publicId, "pdf", {
      resource_type: "raw",
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 120,
      attachment: true,
    });
    const response = await fetch(downloadUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("The uploaded PDF could not be downloaded for validation.");
    const downloaded = new Uint8Array(await response.arrayBuffer());
    const { fileSize, pageCount } = await validateDownloadedPrintPdf(downloaded, asset.bytes);
    const originalFileName = asset.originalFileName
      ? sanitizePrintFileName(asset.originalFileName.endsWith(".pdf") ? asset.originalFileName : `${asset.originalFileName}.pdf`)
      : "document.pdf";
    return {
      publicId,
      assetId: asset.assetId,
      version: asset.version,
      originalFileName,
      fileSize,
      pageCount,
      bytes: downloaded,
    };
  } catch (error) {
    if (deleteAssetId) {
      try {
        await deleteCloudinaryAssetById(deleteAssetId);
      } catch (cleanupError) {
        console.error("INVALID PRINT UPLOAD CLEANUP ERROR:", cleanupError instanceof Error ? cleanupError.name : "Unknown error");
      }
    }
    throw error;
  }
}

export function createPrintDocumentPublicId(printJobId: string) {
  return `${PRINT_DOCUMENT_FOLDER}/${printJobId}.pdf`;
}

export function createPrintJobId() {
  return randomUUID();
}

export function createPrivatePrintDocumentDownloadUrl(publicId: string) {
  configureCloudinary();
  return cloudinary.utils.private_download_url(publicId, "pdf", {
    resource_type: "raw",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 120,
    attachment: true,
  });
}

export async function deletePrivatePrintDocument(publicId: string) {
  configureCloudinary();
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: "raw",
    type: "authenticated",
    invalidate: true,
  });
  if (result.result !== "ok" && result.result !== "not found") {
    throw new Error(`Cloudinary did not confirm document deletion (${String(result.result)}).`);
  }
}
