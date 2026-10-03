import "server-only";

import { NotificationType, Prisma } from "@prisma/client";

type NotificationWriter = Pick<Prisma.TransactionClient, "notification" | "user">;

export async function createNotification(
  tx: NotificationWriter,
  input: { userId: string; type: NotificationType; title: string; message: string; orderId?: string | null; relatedType?: string | null; relatedId?: string | null; idempotencyKey: string },
) {
  const key = input.idempotencyKey.slice(0, 180);
  await tx.notification.createMany({
    data: [{ ...input, idempotencyKey: key }],
    skipDuplicates: true,
  });
}

export async function notifyAdmins(
  tx: NotificationWriter,
  input: { type: NotificationType; title: string; message: string; orderId?: string | null; relatedType?: string | null; relatedId?: string | null; idempotencyKey: string },
) {
  const admins = await tx.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
  if (!admins.length) return;
  await tx.notification.createMany({
    data: admins.map((admin) => ({ ...input, userId: admin.id, idempotencyKey: input.idempotencyKey.slice(0, 180) })),
    skipDuplicates: true,
  });
}
