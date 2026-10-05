import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PRINT_DOCUMENT_BYTES, validatePrintFile } from "./upload-validation";

test("PDF upload validation accepts valid PDFs and rejects other file types", () => {
  assert.equal(validatePrintFile({ name: "notes.pdf", type: "application/pdf", size: 1 }), null);
  assert.equal(validatePrintFile({ name: "notes.PDF", type: "", size: 1 }), null);
  assert.equal(validatePrintFile({ name: "notes.docx", type: "application/pdf", size: 1 }), "Upload a PDF document.");
  assert.equal(validatePrintFile({ name: "notes.pdf", type: "application/msword", size: 1 }), "Upload a PDF document.");
});

test("PDF upload validation enforces non-empty files and the 15 MB limit", () => {
  assert.equal(validatePrintFile({ name: "empty.pdf", type: "application/pdf", size: 0 }), "This file is empty or could not be read. Choose another PDF.");
  assert.equal(validatePrintFile({ name: "large.pdf", type: "application/pdf", size: MAX_PRINT_DOCUMENT_BYTES + 1 }), "PDF documents must be 15 MB or smaller.");
  assert.equal(validatePrintFile({ name: "maximum.pdf", type: "application/pdf", size: MAX_PRINT_DOCUMENT_BYTES }), null);
});
