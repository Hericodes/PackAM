import "server-only";

import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { v2 as cloudinary } from "cloudinary";
import { PRINTING_LIMITS } from "./pricing";
import { MAX_PRINT_DOCUMENT_BYTES } from "./upload-validation";

export { MAX_PRINT_DOCUMENT_BYTES };
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

export async function getPdfPageCount(bytes: Uint8Array) {
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("This file is not a valid PDF. Export it as a PDF and upload it again.");
  }
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
  } catch {
    throw new Error("We couldn't read this PDF. It may be damaged or password-protected.");
  }
  if (pdf.isEncrypted) throw new Error("Password-protected PDFs cannot be printed. Upload an unlocked copy.");
  const pageCount = pdf.getPageCount();
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PRINTING_LIMITS.pages) {
    throw new Error(`PDFs must contain between 1 and ${PRINTING_LIMITS.pages} pages.`);
  }
  return pageCount;
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
  originalFileName: string;
  fileSize: number;
  pageCount: number;
  bytes: Uint8Array;
};

export async function downloadAndValidatePrintDocument(printJobId: string): Promise<VerifiedCloudinaryAsset> {
  configureCloudinary();
  const publicId = `${PRINT_DOCUMENT_FOLDER}/${printJobId}.pdf`;
  const assetValue: unknown = await cloudinary.api.resource(publicId, {
    resource_type: "raw",
    type: "authenticated",
    context: false,
  });
  if (!assetValue || typeof assetValue !== "object") throw new Error("The uploaded PDF could not be verified.");
  const asset = assetValue as Record<string, unknown>;
  if (asset.public_id !== publicId || asset.resource_type !== "raw" || asset.type !== "authenticated" || asset.format !== "pdf") {
    throw new Error("The uploaded file is not a private PDF document.");
  }
  if (typeof asset.bytes !== "number" || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_PRINT_DOCUMENT_BYTES) {
    throw new Error("PDF documents must be 15MB or smaller.");
  }
  const originalFileName = typeof asset.original_filename === "string"
    ? sanitizePrintFileName(asset.original_filename.endsWith(".pdf") ? asset.original_filename : `${asset.original_filename}.pdf`)
    : "document.pdf";

  const downloadUrl = cloudinary.utils.private_download_url(publicId, "pdf", {
    resource_type: "raw",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 120,
    attachment: true,
  });
  const response = await fetch(downloadUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("The uploaded PDF could not be downloaded for validation.");
  const downloaded = new Uint8Array(await response.arrayBuffer());
  if (downloaded.byteLength !== asset.bytes || downloaded.byteLength > MAX_PRINT_DOCUMENT_BYTES) {
    throw new Error("The uploaded PDF did not pass file integrity checks.");
  }
  const pageCount = await getPdfPageCount(downloaded);
  return { publicId, originalFileName, fileSize: downloaded.byteLength, pageCount, bytes: downloaded };
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
