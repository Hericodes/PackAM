import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { assignSlugs, baseSlug, importLookupNames, nameKey, previewImport, type ImportPreview } from "./bulk-import";

type Reader = Pick<Prisma.TransactionClient, "category" | "product">;

/** Identifies one file's exact contents; the import must be of the file that was previewed. */
export function importFileHash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Same name, same file → same id, so a repeated or racing import of one file can't create a product twice. */
function importedProductId(fileHash: string, name: string) {
  return createHash("sha256").update(`${fileHash}:${nameKey(name)}`).digest("hex").slice(0, 32);
}

async function previewWith(reader: Reader, text: string): Promise<ImportPreview> {
  const categories = await reader.category.findMany({ select: { id: true, name: true, slug: true, isActive: true } });
  // Names are read first so existing products are looked up only for this file's names.
  const rough = previewImport(text, categories, []);
  const names = rough.ok ? importLookupNames(rough.rows) : [];
  const existing = names.length
    ? await reader.product.findMany({
        where: { OR: names.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) },
        select: { id: true, name: true, customerPrice: true, status: true, category: { select: { name: true } } },
      })
    : [];
  return previewImport(text, categories, existing.map((product) => ({ id: product.id, name: product.name, customerPrice: product.customerPrice, status: product.status, category: product.category.name })));
}

export function previewProductImport(text: string) {
  return previewWith(db, text);
}

export type ImportResult =
  | { ok: false; status: 400 | 409; error: string }
  | {
      ok: true;
      created: Array<{ row: number; id: string; name: string; status: "ACTIVE" | "INACTIVE" }>;
      skipped: Array<{ row: number; name: string; reason: string; existingId?: string }>;
      failed: Array<{ row: number; name: string; errors: string[] }>;
    };

/**
 * Imports the ready rows of exactly the previewed file, all or nothing. Every row is checked again here
 * against the current database, inside the transaction, so a product added since the preview is skipped
 * rather than duplicated. Existing products are never changed and nothing is ever deleted.
 */
export async function importProducts(actorId: string, text: string, previewedHash: string): Promise<ImportResult> {
  const fileHash = importFileHash(text);
  if (fileHash !== previewedHash) return { ok: false, status: 409, error: "The file changed after the preview. Check the new preview before importing." };

  return db.$transaction(async (tx) => {
    // One import at a time, so two files (or two clicks) can't both add the same new name.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('packam-product-import'))`;
    const preview = await previewWith(tx, text);
    if (!preview.ok) return { ok: false as const, status: 400 as const, error: preview.error };

    const ready = preview.rows.filter((row) => row.outcome === "ready" && row.product);
    const takenSlugs = ready.length
      ? new Set((await tx.product.findMany({ where: { OR: [...new Set(ready.map((row) => baseSlug(row.name)))].map((base) => ({ slug: { startsWith: base } })) }, select: { slug: true } })).map((product) => product.slug))
      : new Set<string>();
    const slugs = assignSlugs(ready.map((row) => row.name), takenSlugs);
    const products = ready.map((row, index) => ({
      id: importedProductId(fileHash, row.name),
      slug: slugs[index],
      name: row.product!.name,
      categoryId: row.product!.categoryId,
      customerPrice: row.product!.customerPrice,
      description: row.product!.description,
      status: row.product!.status,
      imageUrl: null,
    }));
    if (products.length) {
      await tx.product.createMany({ data: products });
      await tx.auditLog.createMany({
        data: products.map((product) => ({
          actorId,
          action: "PRODUCT_CREATED",
          resource: "Product",
          resourceId: product.id,
          newState: { name: product.name, categoryId: product.categoryId, customerPrice: product.customerPrice, status: product.status },
          details: `CSV import ${fileHash.slice(0, 12)}`,
        })),
      });
    }

    return {
      ok: true as const,
      created: ready.map((row, index) => ({ row: row.row, id: products[index].id, name: products[index].name, status: products[index].status })),
      skipped: preview.rows.flatMap((row) =>
        row.outcome === "exists" ? [{ row: row.row, name: row.name, reason: `Already in the catalogue as “${row.existing!.name}”`, existingId: row.existing!.id }]
        : row.outcome === "duplicate-in-file" ? [{ row: row.row, name: row.name, reason: `Same name as row ${row.duplicateOfRow}` }]
        : []),
      failed: preview.rows.filter((row) => row.outcome === "error").map((row) => ({ row: row.row, name: row.name, errors: row.errors })),
    };
  }, { timeout: 60_000 });
}
