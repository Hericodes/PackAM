export const MAX_PRINT_DOCUMENT_BYTES = 15_000_000;

export function validatePrintFile(file: { name: string; type: string; size: number }) {
  if (!/\.pdf$/i.test(file.name) || (file.type !== "" && file.type !== "application/pdf")) {
    return "Upload a PDF document.";
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return "This file is empty or could not be read. Choose another PDF.";
  }
  if (file.size > MAX_PRINT_DOCUMENT_BYTES) {
    return "PDF documents must be 15 MB or smaller.";
  }
  return null;
}
