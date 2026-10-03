import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "./db";

type AuditInput = {
  actorId: string;
  action: string;
  resource: string;
  resourceId: string;
  previousState?: Prisma.InputJsonValue;
  newState?: Prisma.InputJsonValue;
  details?: string;
};

export async function writeAuditLog(tx: Prisma.TransactionClient, input: AuditInput) {
  await tx.auditLog.create({ data: input });
}

export async function writeAuditLogOutsideTransaction(input: AuditInput) {
  await db.auditLog.create({ data: input });
}
