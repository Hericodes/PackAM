import "server-only";

import { randomUUID } from "node:crypto";
import { PaymentProvider, Prisma, PrintColorMode, PrintPaperSize, PrintSides } from "@prisma/client";
import { db } from "../db";
import { CHECKOUT_CURRENCY } from "../checkout-pricing";
import { PRINTING_LIMITS, PRINTING_PRICING_VERSION, calculatePrintPrice, parsePageSelection } from "./pricing";
import {
  createPrintUploadCredentials,
  createPrintJobId,
  deleteCloudinaryAssetById,
  deletePrivatePrintDocument,
  downloadAndValidatePrintDocument,
} from "./document";
import type { PrintUploadIdentity } from "./document-validation";
import { transitionPrintJobInTransaction } from "./status";

export type PrintConfiguration = {
  paperSize: PrintPaperSize;
  colorMode: PrintColorMode;
  sides: PrintSides;
  copies: number;
  pageSelection: string;
  instructions: string | null;
};

function normalizeInstructions(value: string | null) {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > PRINTING_LIMITS.instructionsCharacters) {
    throw new Error(`Instructions must be ${PRINTING_LIMITS.instructionsCharacters} characters or fewer.`);
  }
  return normalized;
}

function calculateJobPrice(configuration: PrintConfiguration, actualPageCount: number) {
  const selection = parsePageSelection(configuration.pageSelection, actualPageCount);
  const pricing = calculatePrintPrice({
    selectedPageCount: selection.selectedPageCount,
    copies: configuration.copies,
    paperSize: configuration.paperSize,
    colorMode: configuration.colorMode,
    sides: configuration.sides,
  });
  return { selection, pricing, instructions: normalizeInstructions(configuration.instructions) };
}

export async function createPrintUploadDraft(userId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, role: "STUDENT", status: "ACTIVE" },
    select: { id: true },
  });
  if (!user) throw new Error("An active student account is required to upload a print document.");

  const reusableDraft = await db.printJob.findFirst({
    where: { userId, status: "DRAFT", document: { is: null }, replacesPrintJobId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (reusableDraft) {
    return { printJobId: reusableDraft.id, credentials: createPrintUploadCredentials(reusableDraft.id) };
  }

  const printJobId = createPrintJobId();
  const credentials = createPrintUploadCredentials(printJobId);
  await db.printJob.create({
    data: {
      id: printJobId,
      userId,
      status: "DRAFT",
      statusHistory: {
        create: { status: "DRAFT", note: "Student started a new print job." },
      },
    },
  });
  return { printJobId, credentials };
}

export async function resumePrintUploadDraft(userId: string, printJobId: string) {
  const [user, job] = await Promise.all([
    db.user.findFirst({ where: { id: userId, role: "STUDENT", status: "ACTIVE" }, select: { id: true } }),
    db.printJob.findFirst({
      where: { id: printJobId, userId, status: "DRAFT", document: { is: null } },
      select: { id: true },
    }),
  ]);
  if (!user) throw new Error("An active student account is required to upload a print document.");
  if (!job) throw new Error("This print upload is no longer available. Refresh the page and try again.");
  return { printJobId: job.id, credentials: createPrintUploadCredentials(job.id) };
}

export async function createPrintDocumentReplacementDraft(userId: string, previousPrintJobId: string) {
  const [user, previous] = await Promise.all([
    db.user.findFirst({ where: { id: userId, role: "STUDENT", status: "ACTIVE" }, select: { id: true } }),
    db.printJob.findFirst({
      where: {
        id: previousPrintJobId,
        userId,
        status: { in: ["DRAFT", "READY_FOR_PAYMENT"] },
        document: { isNot: null },
        payments: { none: { status: { in: ["PENDING", "RECONCILIATION_REQUIRED", "SUCCESS"] } } },
      },
      select: { id: true },
    }),
  ]);
  if (!user) throw new Error("An active student account is required to upload a print document.");
  if (!previous) throw new Error("This document can no longer be replaced. Refresh the page and try again.");

  const existingReplacement = await db.printJob.findFirst({
    where: { userId, status: "DRAFT", replacesPrintJobId: previousPrintJobId, document: { is: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existingReplacement) {
    return { printJobId: existingReplacement.id, credentials: createPrintUploadCredentials(existingReplacement.id) };
  }

  const printJobId = createPrintJobId();
  const credentials = createPrintUploadCredentials(printJobId);
  await db.printJob.create({
    data: {
      id: printJobId,
      userId,
      status: "DRAFT",
      replacesPrintJobId: previousPrintJobId,
      statusHistory: {
        create: { status: "DRAFT", note: "Student started a replacement document upload." },
      },
    },
  });
  return { printJobId, credentials };
}

async function retireReplacedPrintJob(userId: string, previousPrintJobId: string) {
  const document = await db.$transaction(async (tx) => {
    const previous = await tx.printJob.findFirst({
      where: { id: previousPrintJobId, userId },
      select: {
        id: true,
        status: true,
        document: { select: { publicId: true, deletedAt: true } },
        payments: { where: { status: { in: ["PENDING", "RECONCILIATION_REQUIRED", "SUCCESS"] } }, select: { id: true }, take: 1 },
      },
    });
    if (!previous || !previous.document) throw new Error("The previous print document could not be found.");
    if (previous.payments.length) throw new Error("This print job already has a payment attempt and cannot be replaced.");
    if (previous.status !== "CANCELLED") {
      await transitionPrintJobInTransaction(tx, {
        printJobId: previous.id,
        toStatus: "CANCELLED",
        actorId: userId,
        note: "Student replaced the uploaded document.",
      });
    }
    return previous.document;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (document.deletedAt) return null;
  try {
    await deletePrivatePrintDocument(document.publicId);
    await db.printDocument.updateMany({
      where: { printJobId: previousPrintJobId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return null;
  } catch (error) {
    console.error("REPLACED PRINT DOCUMENT CLEANUP ERROR:", error instanceof Error ? error.name : "Unknown error");
    return "The new PDF is ready, but the old private upload could not be removed. Please contact PackAM support.";
  }
}

export async function completePrintDocumentUpload(
  userId: string,
  printJobId: string,
  uploadIdentity: PrintUploadIdentity,
  replacesPrintJobId?: string | null,
) {
  const job = await db.printJob.findFirst({
    where: { id: printJobId, userId, status: "DRAFT" },
    select: { id: true, document: { select: { originalFileName: true, fileSize: true, pageCount: true } }, replacesPrintJobId: true },
  });
  if (!job) throw new Error("This print upload is not available. Start a new print job.");

  let document = job.document;
  if (!document) {
    const verified = await downloadAndValidatePrintDocument(printJobId, uploadIdentity);
    try {
      await db.$transaction(async (tx) => {
        const current = await tx.printJob.findFirst({
          where: { id: printJobId, userId, status: "DRAFT", document: { is: null } },
          select: { id: true },
        });
        if (!current) throw new Error("This print upload has already been completed or expired.");
        await tx.printDocument.create({
          data: {
            printJobId,
            uploadedById: userId,
            publicId: verified.publicId,
            originalFileName: verified.originalFileName,
            mimeType: "application/pdf",
            fileSize: verified.fileSize,
            pageCount: verified.pageCount,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      document = {
        originalFileName: verified.originalFileName,
        fileSize: verified.fileSize,
        pageCount: verified.pageCount,
      };
    } catch (error) {
      try {
        await deleteCloudinaryAssetById(verified.assetId);
      } catch (cleanupError) {
        console.error("PRINT DOCUMENT ORPHAN CLEANUP ERROR:", cleanupError instanceof Error ? cleanupError.name : "Unknown error");
      }
      throw error;
    }
  }

  const replacementId = replacesPrintJobId ?? job.replacesPrintJobId;
  const cleanupWarning = replacementId ? await retireReplacedPrintJob(userId, replacementId) : null;
  return {
    printJobId,
    originalFileName: document.originalFileName,
    fileSize: document.fileSize,
    pageCount: document.pageCount,
    cleanupWarning,
  };
}

export async function quotePrintJob(userId: string, printJobId: string, configuration: PrintConfiguration) {
  const job = await db.printJob.findFirst({
    where: { id: printJobId, userId, status: { in: ["DRAFT", "READY_FOR_PAYMENT"] } },
    select: {
      id: true,
      document: { select: { pageCount: true, deletedAt: true } },
    },
  });
  if (!job) throw new Error("Print job not found.");
  if (!job.document || job.document.deletedAt) throw new Error("Upload a valid PDF before configuring this print job.");
  const { selection, pricing, instructions } = calculateJobPrice(configuration, job.document.pageCount);
  return {
    printJobId: job.id,
    originalPageCount: job.document.pageCount,
    pageSelection: selection.canonical,
    paperSize: configuration.paperSize,
    colorMode: configuration.colorMode,
    sides: configuration.sides,
    instructions,
    ...pricing,
  };
}

function buildPrintCheckoutSnapshot(
  printJobId: string,
  pageCount: number,
  configuration: PrintConfiguration,
  deliveryLocation: { id: string; label: string; address: string; instructions: string | null },
  selection: ReturnType<typeof parsePageSelection>,
  pricing: ReturnType<typeof calculatePrintPrice>,
  instructions: string | null,
) {
  return {
    kind: "PRINT_JOB",
    printJobId,
    documentPageCount: pageCount,
    paperSize: configuration.paperSize,
    colorMode: configuration.colorMode,
    sides: configuration.sides,
    copies: configuration.copies,
    pageSelection: selection.canonical,
    selectedPageCount: selection.selectedPageCount,
    instructions,
    pricePerPage: pricing.ratePerPage,
    pricingVersion: PRINTING_PRICING_VERSION,
    printSubtotal: pricing.printSubtotal,
    deliveryFee: pricing.deliveryFee,
    total: pricing.total,
    currency: CHECKOUT_CURRENCY,
    deliveryLocationId: deliveryLocation.id,
    deliveryLocationLabel: deliveryLocation.label,
    deliveryAddress: deliveryLocation.address,
    deliveryInstructions: deliveryLocation.instructions,
  };
}

function printJobConfigurationData(
  configuration: PrintConfiguration,
  selection: ReturnType<typeof parsePageSelection>,
  pricing: ReturnType<typeof calculatePrintPrice>,
  instructions: string | null,
  snapshot: ReturnType<typeof buildPrintCheckoutSnapshot>,
): Prisma.PrintJobUncheckedUpdateManyInput {
  return {
    paperSize: configuration.paperSize,
    colorMode: configuration.colorMode,
    sides: configuration.sides,
    copies: configuration.copies,
    pageSelection: selection.canonical,
    selectedPageCount: selection.selectedPageCount,
    instructions,
    pricePerPage: pricing.ratePerPage,
    printSubtotal: pricing.printSubtotal,
    deliveryFee: pricing.deliveryFee,
    total: pricing.total,
    pricingVersion: PRINTING_PRICING_VERSION,
    checkoutSnapshot: snapshot as Prisma.InputJsonValue,
  };
}

export async function preparePrintJobForPayment(
  userId: string,
  printJobId: string,
  deliveryLocationId: string,
  configuration: PrintConfiguration,
) {
  if (!deliveryLocationId) throw new Error("Choose a saved delivery location.");
  return db.$transaction(async (tx) => {
    const [user, job, location, outstandingPayment] = await Promise.all([
      tx.user.findFirst({ where: { id: userId, role: "STUDENT", status: "ACTIVE" }, select: { id: true } }),
      tx.printJob.findFirst({
        where: { id: printJobId, userId, status: { in: ["DRAFT", "READY_FOR_PAYMENT"] } },
        select: { id: true, status: true, document: { select: { pageCount: true, deletedAt: true } } },
      }),
      tx.savedLocation.findFirst({ where: { id: deliveryLocationId, userId }, select: { id: true, label: true, address: true, instructions: true } }),
      tx.payment.findFirst({ where: { printJobId, status: { in: ["PENDING", "RECONCILIATION_REQUIRED", "SUCCESS"] } }, select: { id: true } }),
    ]);
    if (!user) throw new Error("An active student account is required.");
    if (!job?.document || job.document.deletedAt) throw new Error("Upload a valid PDF before preparing checkout.");
    if (!location) throw new Error("Choose one of your saved delivery locations.");
    if (outstandingPayment) throw new Error("This print job already has a payment attempt and cannot be changed.");

    const { selection, pricing, instructions } = calculateJobPrice(configuration, job.document.pageCount);
    const snapshot = buildPrintCheckoutSnapshot(
      job.id,
      job.document.pageCount,
      configuration,
      location,
      selection,
      pricing,
      instructions,
    );
    const data = printJobConfigurationData(configuration, selection, pricing, instructions, snapshot);
    if (job.status === "DRAFT") {
      await transitionPrintJobInTransaction(tx, {
        printJobId,
        toStatus: "READY_FOR_PAYMENT",
        actorId: userId,
        note: "Student saved print specifications and delivery details for payment.",
        data,
      });
    } else {
      const changed = await tx.printJob.updateMany({
        where: { id: printJobId, userId, status: "READY_FOR_PAYMENT" },
        data,
      });
      if (changed.count !== 1) throw new Error("This print job changed while its settings were being saved.");
    }
    return {
      printJobId,
      status: "READY_FOR_PAYMENT" as const,
      originalPageCount: job.document.pageCount,
      pageSelection: selection.canonical,
      ...pricing,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getStudentPrintWorkspace(userId: string) {
  const job = await db.printJob.findFirst({
    where: { userId, status: { in: ["DRAFT", "READY_FOR_PAYMENT"] } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      replacesPrintJobId: true,
      paperSize: true,
      colorMode: true,
      sides: true,
      copies: true,
      pageSelection: true,
      instructions: true,
      checkoutSnapshot: true,
      document: { select: { originalFileName: true, fileSize: true, pageCount: true, deletedAt: true } },
    },
  });
  if (!job) return null;

  if (!job.document && job.replacesPrintJobId) {
    const previous = await db.printJob.findFirst({
      where: {
        id: job.replacesPrintJobId,
        userId,
        status: { in: ["DRAFT", "READY_FOR_PAYMENT"] },
        document: { is: { deletedAt: null } },
      },
      select: {
        id: true,
        status: true,
        replacesPrintJobId: true,
        paperSize: true,
        colorMode: true,
        sides: true,
        copies: true,
        pageSelection: true,
        instructions: true,
        checkoutSnapshot: true,
        document: { select: { originalFileName: true, fileSize: true, pageCount: true, deletedAt: true } },
      },
    });
    if (previous?.document) {
      const { checkoutSnapshot, ...workspace } = previous;
      const snapshot = checkoutSnapshot && typeof checkoutSnapshot === "object" && !Array.isArray(checkoutSnapshot) ? checkoutSnapshot : null;
      return {
        ...workspace,
        deliveryLocationId: snapshot && typeof snapshot.deliveryLocationId === "string" ? snapshot.deliveryLocationId : null,
        pendingUploadJobId: job.id,
        pendingReplacementForJobId: previous.id,
        document: {
          originalFileName: previous.document.originalFileName,
          fileSize: previous.document.fileSize,
          pageCount: previous.document.pageCount,
        },
      };
    }
  }

  const { checkoutSnapshot, ...workspace } = job;
  const snapshot = checkoutSnapshot;
  const snapshotRecord = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null;
  const deliveryLocationId = snapshotRecord && typeof snapshotRecord.deliveryLocationId === "string"
    ? snapshotRecord.deliveryLocationId
    : null;
  return {
    ...workspace,
    deliveryLocationId,
    pendingUploadJobId: !job.document ? job.id : null,
    pendingReplacementForJobId: job.replacesPrintJobId,
    document: job.document && !job.document.deletedAt
      ? { originalFileName: job.document.originalFileName, fileSize: job.document.fileSize, pageCount: job.document.pageCount }
      : null,
  };
}

export async function createPrintPaymentAttempt(
  provider: PaymentProvider,
  userId: string,
  printJobId: string,
  deliveryLocationId: string,
  deliveryInstructions: string | null,
  configuration: PrintConfiguration,
  idempotencyKey: string,
) {
  const key = idempotencyKey.trim();
  if (!key || key.length > 128) throw new Error("A valid payment idempotency key is required.");
  if (!deliveryLocationId) throw new Error("Choose a saved delivery location.");
  const instructions = normalizeInstructions(deliveryInstructions);

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.payment.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
        select: { id: true, transactionReference: true, provider: true, status: true, amount: true, currency: true, orderId: true, printJobId: true },
      });
      if (existing) {
        if (existing.printJobId !== printJobId) throw new Error("This payment request key was already used.");
        return existing;
      }

      const [user, job, location, outstandingAttempt] = await Promise.all([
        tx.user.findFirst({ where: { id: userId, role: "STUDENT", status: "ACTIVE" }, select: { id: true } }),
        tx.printJob.findFirst({
          where: { id: printJobId, userId, status: { in: ["DRAFT", "READY_FOR_PAYMENT"] } },
          select: { id: true, status: true, document: { select: { pageCount: true, deletedAt: true } } },
        }),
        tx.savedLocation.findFirst({ where: { id: deliveryLocationId, userId }, select: { id: true, address: true, instructions: true } }),
        tx.payment.findFirst({
          where: { printJobId, status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] }, orderId: null },
          select: { id: true },
        }),
      ]);
      if (!user) throw new Error("An active student account is required.");
      if (!job) throw new Error("Print job not found.");
      if (!job.document || job.document.deletedAt) throw new Error("Upload a valid PDF before preparing checkout.");
      if (!location) throw new Error("Choose one of your saved delivery locations.");
      if (outstandingAttempt) throw new Error("A payment for this print job is already pending. Check its payment status before trying again.");
      const calculated = calculateJobPrice(configuration, job.document.pageCount);
      const pricing = calculated.pricing;
      const resolvedDeliveryInstructions = instructions ?? location.instructions ?? null;
      const snapshot = {
        kind: "PRINT_JOB",
        printJobId,
        documentPageCount: job.document.pageCount,
        paperSize: configuration.paperSize,
        colorMode: configuration.colorMode,
        sides: configuration.sides,
        copies: configuration.copies,
        pageSelection: calculated.selection.canonical,
        selectedPageCount: calculated.selection.selectedPageCount,
        instructions: calculated.instructions,
        pricePerPage: pricing.ratePerPage,
        pricingVersion: PRINTING_PRICING_VERSION,
        printSubtotal: pricing.printSubtotal,
        deliveryFee: pricing.deliveryFee,
        total: pricing.total,
        currency: CHECKOUT_CURRENCY,
        deliveryLocationId: location.id,
        deliveryAddress: location.address,
        deliveryInstructions: resolvedDeliveryInstructions,
      };
      const printConfigurationData = {
        paperSize: configuration.paperSize,
        colorMode: configuration.colorMode,
        sides: configuration.sides,
        copies: configuration.copies,
        pageSelection: calculated.selection.canonical,
        selectedPageCount: calculated.selection.selectedPageCount,
        instructions: calculated.instructions,
        pricePerPage: pricing.ratePerPage,
        printSubtotal: pricing.printSubtotal,
        deliveryFee: pricing.deliveryFee,
        total: pricing.total,
        pricingVersion: PRINTING_PRICING_VERSION,
        checkoutSnapshot: snapshot as Prisma.InputJsonValue,
      };

      if (job.status === "DRAFT") {
        await transitionPrintJobInTransaction(tx, {
          printJobId,
          toStatus: "READY_FOR_PAYMENT",
          actorId: userId,
          note: "Student confirmed print specifications and delivery details.",
          data: printConfigurationData,
        });
      } else {
        const update = await tx.printJob.updateMany({
          where: { id: printJobId, userId, status: "READY_FOR_PAYMENT" },
          data: printConfigurationData,
        });
        if (update.count !== 1) throw new Error("This print job changed while checkout was starting.");
      }

      return tx.payment.create({
        data: {
          userId,
          printJobId,
          provider,
          status: "PENDING",
          amount: pricing.total,
          currency: CHECKOUT_CURRENCY,
          transactionReference: `packam_${randomUUID()}`,
          idempotencyKey: key,
          checkoutSnapshot: snapshot as Prisma.InputJsonValue,
        },
        select: { id: true, transactionReference: true, provider: true, status: true, amount: true, currency: true, orderId: true, printJobId: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.payment.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
        select: { id: true, transactionReference: true, provider: true, status: true, amount: true, currency: true, orderId: true, printJobId: true },
      });
      if (existing?.printJobId === printJobId) return existing;
    }
    throw error;
  }
}

export async function getStudentPrintJob(userId: string, printJobId: string) {
  return db.printJob.findFirst({
    where: { id: printJobId, userId },
    include: {
      document: { select: { originalFileName: true, mimeType: true, fileSize: true, pageCount: true, expiresAt: true, deletedAt: true } },
      order: {
        select: {
          id: true,
          status: true,
          total: true,
          currency: true,
          payment: { select: { status: true } },
          deliveryAddress: true,
          deliveryInstructions: true,
          createdAt: true,
        },
      },
      statusHistory: { orderBy: { createdAt: "asc" }, select: { status: true, note: true, createdAt: true } },
    },
  });
}
