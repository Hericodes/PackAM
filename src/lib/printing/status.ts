import "server-only";

import { PrintJobStatus, Prisma } from "@prisma/client";
import { createNotification } from "../notifications";
import { canTransitionPrintJob } from "./status-machine";

const events: Partial<Record<PrintJobStatus, { type: "ORDER" | "PAYMENT" | "DELIVERY"; title: string; message: string }>> = {
  PAYMENT_CONFIRMED: { type: "PAYMENT", title: "Print payment confirmed", message: "We’ve got your print job 🫡" },
  RUNNER_ASSIGNED: { type: "DELIVERY", title: "Print runner assigned", message: "Someone has accepted the print mission. 🖨️" },
  DOCUMENT_RECEIVED: { type: "ORDER", title: "Document received", message: "Your document is with the runner." },
  PRINTING: { type: "ORDER", title: "Printing started", message: "Your document is being printed. 👀" },
  PRINTED: { type: "ORDER", title: "Printing complete", message: "Your document is printed. We’re bringing it to you." },
  OUT_FOR_DELIVERY: { type: "DELIVERY", title: "Print job on the move", message: "Your print job is on the move. 🚶" },
  DELIVERED: { type: "DELIVERY", title: "Print job delivered", message: "Your document don land. 🖨️🎒" },
  DOCUMENT_UNREADABLE: { type: "ORDER", title: "Print issue", message: "The runner couldn’t read the document. PackAM operations is reviewing it." },
  PRINT_FAILED: { type: "ORDER", title: "Print issue", message: "The runner reported a printing problem. PackAM operations is reviewing it." },
  REFUND_PROCESSING: { type: "PAYMENT", title: "Print refund processing", message: "Your print-job refund is being processed. We’ll update you when it is confirmed." },
  REFUNDED: { type: "PAYMENT", title: "Print refund confirmed", message: "Your print-job refund has been confirmed." },
};

export async function transitionPrintJobInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    printJobId: string;
    toStatus: PrintJobStatus;
    actorId?: string | null;
    note: string;
    guard?: Prisma.PrintJobWhereInput;
    data?: Prisma.PrintJobUncheckedUpdateManyInput;
  },
) {
  const job = await tx.printJob.findUnique({
    where: { id: input.printJobId },
    select: { id: true, status: true, userId: true, orderId: true },
  });
  if (!job) throw new Error("Print job not found.");
  if (!canTransitionPrintJob(job.status, input.toStatus)) {
    throw new Error(`Print job cannot move from ${job.status} to ${input.toStatus}.`);
  }

  const changed = await tx.printJob.updateMany({
    where: { id: job.id, status: job.status, ...input.guard },
    data: { ...input.data, status: input.toStatus },
  });
  if (changed.count !== 1) throw new Error("Print job status changed while this action was being processed.");
  await tx.printJobStatusHistory.create({
    data: {
      printJobId: job.id,
      status: input.toStatus,
      note: input.note,
      actorId: input.actorId ?? null,
    },
  });
  const event = events[input.toStatus];
  if (event) {
    await createNotification(tx, {
      userId: job.userId,
      orderId: job.orderId,
      relatedType: "PRINT_JOB",
      relatedId: job.id,
      type: event.type,
      title: event.title,
      message: event.message,
      idempotencyKey: `print-job:${job.id}:${input.toStatus}`,
    });
  }
  if (["DELIVERED", "CANCELLED", "REFUNDED", "FAILED"].includes(input.toStatus)) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await tx.printDocument.updateMany({
      where: { printJobId: job.id, deletedAt: null },
      data: { expiresAt },
    });
  }
  return { previousStatus: job.status, status: input.toStatus };
}
