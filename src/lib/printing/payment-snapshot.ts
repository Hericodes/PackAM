import { CHECKOUT_CURRENCY, CHECKOUT_DELIVERY_FEE } from "../checkout-pricing";
import { PRINTING_LIMITS, PRINTING_PRICING_VERSION, PRINTING_PRICES } from "./pricing";
import { parsePageSelection } from "./page-selection";
import { MAX_PRINT_DOCUMENT_BYTES } from "./upload-validation";
import { isPrintJobPastPayment } from "./status-machine";

export type PrintCheckoutSnapshot = {
  kind: "PRINT_JOB";
  printJobId: string;
  documentId: string;
  documentPublicId: string;
  documentName: string;
  documentFileSize: number;
  documentPageCount: number;
  paperSize: "A4";
  colorMode: "BLACK_AND_WHITE" | "COLOR";
  sides: "SINGLE" | "DOUBLE";
  copies: number;
  pageSelection: string;
  selectedPageCount: number;
  instructions: string | null;
  pricePerPage: number;
  pricingVersion: string;
  printSubtotal: number;
  deliveryFee: number;
  total: number;
  currency: string;
  deliveryLocationId: string;
  deliveryLocationLabel: string;
  deliveryAddress: string;
  deliveryInstructions: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

type DocumentSnapshotFallback = Pick<PrintCheckoutSnapshot, "documentId" | "documentPublicId" | "documentName" | "documentFileSize">;

export function parsePrintCheckoutSnapshot(
  value: unknown,
  documentFallback?: DocumentSnapshotFallback,
): PrintCheckoutSnapshot {
  if (!isRecord(value)) throw new Error("Print job has no valid saved checkout snapshot.");
  const fields = [
    "printJobId",
    "deliveryLocationId",
    "deliveryLocationLabel",
    "deliveryAddress",
  ] as const;
  if (fields.some((field) => !isText(value[field])) ||
    (!documentFallback && ["documentId", "documentPublicId", "documentName"].some((field) => !isText(value[field])))) {
    throw new Error("Print job checkout snapshot is missing required details.");
  }
  const documentId = isText(value.documentId) ? value.documentId : documentFallback?.documentId;
  const documentPublicId = isText(value.documentPublicId) ? value.documentPublicId : documentFallback?.documentPublicId;
  const documentName = isText(value.documentName) ? value.documentName : documentFallback?.documentName;
  const documentFileSize = isSafePositiveInteger(value.documentFileSize)
    ? value.documentFileSize
    : documentFallback?.documentFileSize;
  if (!documentId || !documentPublicId || !documentName || !isSafePositiveInteger(documentFileSize)) {
    throw new Error("Print job checkout snapshot is missing document details.");
  }
  const resolvedDocumentFileSize = documentFileSize;
  const copies = value.copies as number;
  const documentPageCount = value.documentPageCount as number;
  if (
    value.kind !== "PRINT_JOB" ||
    value.paperSize !== "A4" ||
    (value.colorMode !== "BLACK_AND_WHITE" && value.colorMode !== "COLOR") ||
    (value.sides !== "SINGLE" && value.sides !== "DOUBLE") ||
    resolvedDocumentFileSize > MAX_PRINT_DOCUMENT_BYTES ||
    !isSafePositiveInteger(documentPageCount) ||
    documentPageCount > PRINTING_LIMITS.pages ||
    !isSafePositiveInteger(copies) ||
    copies > PRINTING_LIMITS.copies ||
    !isText(value.pageSelection) ||
    !isSafePositiveInteger(value.selectedPageCount) ||
    (value.instructions !== null && typeof value.instructions !== "string") ||
    (typeof value.instructions === "string" && value.instructions.length > 500) ||
    !isSafePositiveInteger(value.pricePerPage) ||
    value.pricingVersion !== PRINTING_PRICING_VERSION ||
    !isSafePositiveInteger(value.printSubtotal) ||
    value.deliveryFee !== CHECKOUT_DELIVERY_FEE ||
    !isSafePositiveInteger(value.total) ||
    value.currency !== CHECKOUT_CURRENCY ||
    (value.deliveryInstructions !== null && typeof value.deliveryInstructions !== "string")
  ) {
    throw new Error("Print job checkout snapshot contains invalid settings or totals.");
  }

  const colorMode = value.colorMode as PrintCheckoutSnapshot["colorMode"];
  const paperSize = value.paperSize as PrintCheckoutSnapshot["paperSize"];
  const sides = value.sides as PrintCheckoutSnapshot["sides"];
  const pageSelection = value.pageSelection as string;
  const selectedPageCount = value.selectedPageCount as number;
  const instructions = value.instructions as string | null;
  const pricePerPage = value.pricePerPage as number;
  const pricingVersion = value.pricingVersion as string;
  const printSubtotal = value.printSubtotal as number;
  const total = value.total as number;
  const currency = value.currency as string;
  const deliveryInstructions = value.deliveryInstructions as string | null;
  const expectedRate = PRINTING_PRICES[paperSize][colorMode];
  const selection = parsePageSelection(pageSelection, documentPageCount);
  const expectedSubtotal = selection.selectedPageCount * copies * expectedRate;
  const expectedTotal = expectedSubtotal + CHECKOUT_DELIVERY_FEE;
  if (
    selection.canonical !== pageSelection ||
    selection.selectedPageCount !== selectedPageCount ||
    pricePerPage !== expectedRate ||
    printSubtotal !== expectedSubtotal ||
    total !== expectedTotal
  ) {
    throw new Error("Print job checkout snapshot totals do not match its saved configuration.");
  }

  return {
    kind: "PRINT_JOB",
    printJobId: value.printJobId as string,
    documentId,
    documentPublicId,
    documentName,
    documentFileSize: resolvedDocumentFileSize,
    documentPageCount,
    paperSize,
    colorMode,
    sides,
    copies,
    pageSelection,
    selectedPageCount,
    instructions,
    pricePerPage,
    pricingVersion,
    printSubtotal,
    deliveryFee: CHECKOUT_DELIVERY_FEE,
    total,
    currency,
    deliveryLocationId: value.deliveryLocationId as string,
    deliveryLocationLabel: value.deliveryLocationLabel as string,
    deliveryAddress: value.deliveryAddress as string,
    deliveryInstructions,
  };
}

export function assertPrintCheckoutSnapshotsMatch(
  paymentSnapshot: unknown,
  jobSnapshot: PrintCheckoutSnapshot,
) {
  const payment = parsePrintCheckoutSnapshot(paymentSnapshot);
  if (JSON.stringify(payment) !== JSON.stringify(jobSnapshot)) {
    throw new Error("Payment attempt snapshot does not match the prepared print job.");
  }
}

export function assertPrintJobMatchesCheckoutSnapshot(
  job: {
    id: string;
    status: string;
    paperSize: string;
    colorMode: string | null;
    sides: string | null;
    copies: number;
    pageSelection: string;
    instructions: string | null;
    pricePerPage: number | null;
    printSubtotal: number | null;
    deliveryFee: number | null;
    total: number | null;
    pricingVersion: string | null;
    document: {
      id: string;
      publicId: string;
      originalFileName: string;
      fileSize: number;
      pageCount: number;
      mimeType: string;
      storageProvider: string;
      deletedAt: Date | null;
    } | null;
  },
  snapshotValue: unknown,
  expectedStatus = "READY_FOR_PAYMENT",
) {
  const snapshot = parsePrintCheckoutSnapshot(
    snapshotValue,
    job.document
      ? {
          documentId: job.document.id,
          documentPublicId: job.document.publicId,
          documentName: job.document.originalFileName,
          documentFileSize: job.document.fileSize,
        }
      : undefined,
  );
  if (
    job.id !== snapshot.printJobId ||
    job.status !== expectedStatus ||
    !job.document ||
    job.document.deletedAt ||
    job.document.id !== snapshot.documentId ||
    job.document.publicId !== snapshot.documentPublicId ||
    job.document.originalFileName !== snapshot.documentName ||
    job.document.fileSize !== snapshot.documentFileSize ||
    job.document.pageCount !== snapshot.documentPageCount ||
    job.document.mimeType !== "application/pdf" ||
    job.document.storageProvider !== "CLOUDINARY" ||
    snapshot.documentPublicId !== `packam/print-jobs/${job.id}.pdf` ||
    job.paperSize !== snapshot.paperSize ||
    job.colorMode !== snapshot.colorMode ||
    job.sides !== snapshot.sides ||
    job.copies !== snapshot.copies ||
    job.pageSelection !== snapshot.pageSelection ||
    job.instructions !== snapshot.instructions ||
    job.pricePerPage !== snapshot.pricePerPage ||
    job.printSubtotal !== snapshot.printSubtotal ||
    job.deliveryFee !== snapshot.deliveryFee ||
    job.total !== snapshot.total ||
    job.pricingVersion !== snapshot.pricingVersion
  ) {
    throw new Error("Print job settings do not match the saved checkout snapshot.");
  }
  return snapshot;
}

export function validatePrintPaymentFinalization(input: {
  payment: {
    userId: string;
    printJobId: string | null;
    provider: string;
    status: string;
    amount: number;
    currency: string;
    orderId: string | null;
    providerReference: string | null;
    checkoutSnapshot: unknown;
  };
  job: Parameters<typeof assertPrintJobMatchesCheckoutSnapshot>[0] & {
    userId: string;
    checkoutSnapshot: unknown;
  };
  verified: {
    provider: string;
    amount: number;
    currency: string;
    providerReference: string;
  };
  /** True when another payment for this print job has already succeeded. */
  otherSuccessfulPayment?: boolean;
}) {
  const { payment, job, verified } = input;
  if (
    verified.provider !== "OPAY" ||
    !verified.providerReference ||
    payment.provider !== verified.provider ||
    !payment.printJobId ||
    payment.printJobId !== job.id ||
    payment.userId !== job.userId ||
    payment.orderId !== null
  ) {
    throw new Error("Payment attempt is not linked to this print job.");
  }
  if (payment.status === "SUCCESS" && payment.providerReference !== verified.providerReference) {
    throw new Error("Successful print payment has a different OPay transaction reference.");
  }
  if (
    payment.amount !== verified.amount ||
    payment.currency !== verified.currency.toUpperCase() ||
    (payment.providerReference && payment.providerReference !== verified.providerReference)
  ) {
    throw new Error("Verified payment identity, amount or currency does not match the print checkout.");
  }

  if (payment.status === "SUCCESS") {
    // Repeated callbacks arrive after fulfilment has moved on; they must stay idempotent.
    if (!isPrintJobPastPayment(job.status)) {
      throw new Error("Successful print payment has an unexpected print-job status.");
    }
    const snapshot = assertPrintJobMatchesCheckoutSnapshot(job, job.checkoutSnapshot, job.status);
    assertPrintCheckoutSnapshotsMatch(payment.checkoutSnapshot, snapshot);
    if (payment.amount !== snapshot.total || payment.currency !== snapshot.currency) {
      throw new Error("Successful print payment does not match its saved checkout snapshot.");
    }
    return { snapshot, alreadyProcessed: true as const };
  }

  // A provider can confirm an attempt PackAM already marked FAILED (a late success).
  if (payment.status !== "PENDING" && payment.status !== "RECONCILIATION_REQUIRED" && payment.status !== "FAILED") {
    throw new Error("Print payment attempt is no longer pending.");
  }
  // The job was already paid for: this verified success is a second payment. It must be recorded
  // for operations, never finalised, so fulfilment cannot start twice.
  if (input.otherSuccessfulPayment || isPrintJobPastPayment(job.status)) {
    return { alreadyProcessed: false as const, duplicate: true as const };
  }
  const snapshot = assertPrintJobMatchesCheckoutSnapshot(job, job.checkoutSnapshot);
  assertPrintCheckoutSnapshotsMatch(payment.checkoutSnapshot, snapshot);
  if (payment.amount !== snapshot.total || payment.currency !== snapshot.currency) {
    throw new Error("Print payment does not match its saved checkout snapshot.");
  }
  // The job's only payment: finalise it once, even if it was earlier marked FAILED.
  return { snapshot, alreadyProcessed: false as const, duplicate: false as const, confirmedAfterFailure: payment.status === "FAILED" };
}
