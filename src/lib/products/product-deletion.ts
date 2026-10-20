import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { productDeletionBlocker } from "./admin-catalogue";

export type ProductDeletionResult =
  | { kind: "DELETED"; name: string; removedFromCarts: number }
  | { kind: "NOT_FOUND" }
  | { kind: "BLOCKED"; reason: string };

async function openCheckoutsContaining(tx: Prisma.TransactionClient, productId: string) {
  // Checkout snapshots are JSON with no foreign key, so look inside them for this product.
  const [row] = await tx.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count FROM "Payment"
    WHERE "status" IN ('PENDING', 'RECONCILIATION_REQUIRED')
      AND "printJobId" IS NULL
      AND "orderId" IS NULL
      AND "checkoutSnapshot" @> jsonb_build_object('items', jsonb_build_array(jsonb_build_object('productId', ${productId}::text)))
  `;
  return row?.count ?? 0;
}

/**
 * Permanently deletes an unreferenced, inactive product. Every check runs inside one serializable
 * transaction, so a checkout or order cannot start using the product between the check and the delete.
 *
 * What a delete removes: the product, its vendor sources and their price/availability history
 * (cascade), and the product from any student cart. Product requests keep their text and lose only
 * the link (SET NULL). Orders, order items, payments and refunds are never touched: a product with
 * any of them is refused and stays INACTIVE.
 */
export async function deleteProductAsAdmin(adminId: string, productId: string): Promise<ProductDeletionResult> {
  return retrySerializable(() => db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, slug: true, status: true, customerPrice: true, categoryId: true, imageUrl: true, _count: { select: { orderItems: true } } },
    });
    if (!product) return { kind: "NOT_FOUND" as const };

    const reason = productDeletionBlocker({ status: product.status, orderItems: product._count.orderItems, openCheckouts: await openCheckoutsContaining(tx, product.id) });
    if (reason) return { kind: "BLOCKED" as const, reason };

    // Sourcing records from real orders also block (ON DELETE RESTRICT); there are none without order items.
    const removed = await tx.cartItem.deleteMany({ where: { productId: product.id } });
    await tx.product.delete({ where: { id: product.id } });
    await writeAuditLog(tx, {
      actorId: adminId,
      action: "PRODUCT_DELETED",
      resource: "Product",
      resourceId: product.id,
      previousState: { name: product.name, slug: product.slug, status: product.status, customerPrice: product.customerPrice, categoryId: product.categoryId, imageUrl: product.imageUrl },
      details: removed.count ? `Removed from ${removed.count} student cart${removed.count === 1 ? "" : "s"}.` : undefined,
    });
    return { kind: "DELETED" as const, name: product.name, removedFromCarts: removed.count };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 5, baseDelayMs: 25 });
}
