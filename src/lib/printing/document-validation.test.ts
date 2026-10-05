import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  validateDownloadedPrintPdf,
  validatePrivatePrintAsset,
  type PrintUploadIdentity,
} from "./document-validation";
import { MAX_PRINT_DOCUMENT_BYTES } from "./upload-validation";

const publicId = "packam/print-jobs/print-job-123.pdf";
const identity: PrintUploadIdentity = { assetId: "cloudinary-asset-456", version: 1_759_682_911 };

function privateRawPdf(overrides: Record<string, unknown> = {}) {
  return {
    public_id: publicId,
    asset_id: identity.assetId,
    version: identity.version,
    resource_type: "raw",
    type: "authenticated",
    bytes: 1024,
    ...overrides,
  };
}

async function createPdf(pageCount: number) {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) pdf.addPage();
  return new Uint8Array(await pdf.save());
}

test("accepts Cloudinary raw authenticated PDFs whose format is encoded in the public ID", () => {
  const asset = validatePrivatePrintAsset(privateRawPdf(), publicId, identity);
  assert.equal(asset.publicId, publicId);
  assert.equal(asset.assetId, identity.assetId);
  assert.equal(asset.version, identity.version);
  assert.equal(asset.bytes, 1024);
});

test("rejects public assets, non-raw assets, and non-authenticated delivery", () => {
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ type: "upload" }), publicId, identity));
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ resource_type: "image" }), publicId, identity));
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ type: "private" }), publicId, identity));
});

test("rejects assets that do not match the server-derived document and uploaded asset identity", () => {
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ public_id: "other/job.pdf" }), publicId, identity));
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ asset_id: "different-asset" }), publicId, identity));
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ version: identity.version + 1 }), publicId, identity));
});

test("rejects invalid or missing Cloudinary metadata and an explicitly non-PDF format", () => {
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ asset_id: undefined }), publicId, identity));
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ version: undefined }), publicId, identity));
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ bytes: undefined }), publicId, identity));
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ bytes: MAX_PRINT_DOCUMENT_BYTES + 1 }), publicId, identity));
  assert.throws(() => validatePrivatePrintAsset(privateRawPdf({ format: "zip" }), publicId, identity));
});

test("rejects non-PDF downloaded content even when Cloudinary metadata claims a private PDF", async () => {
  const bytes = new TextEncoder().encode("not a PDF");
  const metadata = validatePrivatePrintAsset(privateRawPdf({ bytes: bytes.byteLength }), publicId, identity);
  await assert.rejects(validateDownloadedPrintPdf(bytes, metadata.bytes), /not a valid PDF/i);
});

test("downloads of valid private PDF content proceed to page-count validation", async () => {
  const bytes = await createPdf(3);
  const metadata = validatePrivatePrintAsset(privateRawPdf({ bytes: bytes.byteLength }), publicId, identity);
  const verified = await validateDownloadedPrintPdf(bytes, metadata.bytes);
  assert.equal(verified.fileSize, bytes.byteLength);
  assert.equal(verified.pageCount, 3);
  assert.equal(metadata.assetId, identity.assetId);
});

test("rejects a downloaded PDF whose byte count does not match Cloudinary metadata", async () => {
  const bytes = await createPdf(1);
  await assert.rejects(validateDownloadedPrintPdf(bytes, bytes.byteLength + 1), /integrity checks/i);
});
