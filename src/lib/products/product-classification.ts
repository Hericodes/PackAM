import "server-only";

import { db } from "../db";
import { parseLabelIds, parseStockInput } from "./catalogue-admin";

type Body = { subcategoryId?: unknown; labelIds?: unknown; stockQuantity?: unknown };
export type Classification = { subcategoryId?: string | null; labelIds?: string[]; stockQuantity?: number | null };

/**
 * Checks the subcategory, labels and stock sent with a product create or edit. Only fields that were sent
 * are returned. The subcategory must belong to `categoryId` (a database trigger enforces this too); every
 * label must exist; stock is for simple products only (a product with variants keeps stock per variant).
 */
export async function parseClassification(body: Body, categoryId: string, options: { hasVariants: boolean }): Promise<{ ok: true; data: Classification } | { ok: false; error: string }> {
  const data: Classification = {};
  if (body.subcategoryId !== undefined) {
    if (body.subcategoryId === null || body.subcategoryId === "") data.subcategoryId = null;
    else if (typeof body.subcategoryId !== "string") return { ok: false, error: "Invalid subcategory." };
    else {
      const subcategory = await db.subcategory.findFirst({ where: { id: body.subcategoryId, categoryId }, select: { id: true } });
      if (!subcategory) return { ok: false, error: "That subcategory isn’t part of the chosen category." };
      data.subcategoryId = subcategory.id;
    }
  }
  if (body.labelIds !== undefined) {
    const labels = parseLabelIds(body.labelIds);
    if (!labels.ok) return labels;
    if (labels.value.length && (await db.productLabel.count({ where: { id: { in: labels.value } } })) !== labels.value.length) return { ok: false, error: "One of those labels no longer exists. Refresh and try again." };
    data.labelIds = labels.value;
  }
  if (body.stockQuantity !== undefined) {
    const stock = parseStockInput(body.stockQuantity);
    if (!stock.ok) return stock;
    if (options.hasVariants && stock.value !== null) return { ok: false, error: "This product has options, so its stock is set per variant." };
    data.stockQuantity = stock.value;
  }
  return { ok: true, data };
}
