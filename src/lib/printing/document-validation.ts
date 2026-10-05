import { PDFDocument } from "pdf-lib";
import { MAX_PRINT_DOCUMENT_BYTES } from "./upload-validation";
import { PRINTING_LIMITS } from "./pricing";

export type PrintUploadIdentity = {
  assetId: string;
  version: number;
};

export type VerifiedPrintAsset = PrintUploadIdentity & {
  publicId: string;
  bytes: number;
  originalFileName: string | null;
};

export function validatePrivatePrintAsset(
  value: unknown,
  expectedPublicId: string,
  expectedIdentity: PrintUploadIdentity,
): VerifiedPrintAsset {
  if (!expectedPublicId.toLowerCase().endsWith(".pdf")) {
    throw new Error("The uploaded file is not a PDF document.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The uploaded PDF could not be verified.");
  }

  const asset = value as Record<string, unknown>;
  if (
    asset.public_id !== expectedPublicId ||
    asset.resource_type !== "raw" ||
    asset.type !== "authenticated" ||
    asset.asset_id !== expectedIdentity.assetId ||
    asset.version !== expectedIdentity.version
  ) {
    throw new Error("The uploaded file is not the private PDF document for this print job.");
  }

  if ("format" in asset && asset.format !== "pdf") {
    throw new Error("The uploaded file is not a PDF document.");
  }
  if (
    typeof asset.bytes !== "number" ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes <= 0 ||
    asset.bytes > MAX_PRINT_DOCUMENT_BYTES
  ) {
    throw new Error("PDF documents must be 15MB or smaller.");
  }

  return {
    publicId: expectedPublicId,
    assetId: expectedIdentity.assetId,
    version: expectedIdentity.version,
    bytes: asset.bytes,
    originalFileName: typeof asset.original_filename === "string" ? asset.original_filename : null,
  };
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

export async function validateDownloadedPrintPdf(bytes: Uint8Array, expectedSize: number) {
  if (bytes.byteLength !== expectedSize || bytes.byteLength > MAX_PRINT_DOCUMENT_BYTES) {
    throw new Error("The uploaded PDF did not pass file integrity checks.");
  }
  return { fileSize: bytes.byteLength, pageCount: await getPdfPageCount(bytes) };
}
