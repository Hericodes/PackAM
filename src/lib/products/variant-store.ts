import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { isPackamProductImageUrl } from "../cloudinary-url";
import { verifyProductImageForSave } from "./product-image-server";
import { describeOptions, optionKeyFor, type VariantSetupInput } from "./variants";

type Result = { ok: true; variantCount: number } | { ok: false; status: number; error: string };

/** A product's options and variants in the shape the admin editor works with (ids double as keys). */
export async function loadVariantSetup(productId: string) {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: {
      id: true, shopId: true,
      options: { orderBy: { position: "asc" }, select: { id: true, name: true, values: { orderBy: { position: "asc" }, select: { id: true, value: true } } } },
      variants: { orderBy: { createdAt: "asc" }, select: { id: true, price: true, stockQuantity: true, sku: true, status: true, imageUrl: true, values: { select: { optionValueId: true } }, _count: { select: { orderItems: true, cartItems: true } } } },
    },
  });
  if (!product) return null;
  return {
    isFood: Boolean(product.shopId),
    options: product.options.map((option) => ({ key: option.id, name: option.name, values: option.values.map((value) => ({ key: value.id, value: value.value })) })),
    variants: product.variants.map((variant) => ({
      id: variant.id, valueKeys: variant.values.map((value) => value.optionValueId), price: variant.price, stockQuantity: variant.stockQuantity,
      sku: variant.sku, active: variant.status === "ACTIVE", imageUrl: variant.imageUrl, inUse: variant._count.orderItems + variant._count.cartItems > 0,
    })),
  };
}

/**
 * Replaces a product's option groups and variants with the admin's validated setup, in one serializable
 * transaction. Existing options, values and variants are kept and updated (matched by id, or by
 * combination for variants), so renaming a value keeps its variants. A combination that has been ordered or
 * is in a cart is never deleted: the admin is asked to mark it unavailable instead. The product's own
 * price becomes its cheapest available variant, which listing pages show as "From ₦X".
 */
export async function saveVariantSetup(adminId: string, productId: string, setup: VariantSetupInput): Promise<Result> {
  const current = await db.product.findUnique({ where: { id: productId }, select: { shopId: true, variants: { select: { imageUrl: true } } } });
  if (!current) return { ok: false, status: 404, error: "Product not found." };
  if (current.shopId) return { ok: false, status: 400, error: "Food menu items don’t use options. Use plates and extras in Admin → Food." };
  const known = new Set(current.variants.map((variant) => variant.imageUrl).filter(Boolean));
  for (const variant of setup.variants) {
    if (!variant.imageUrl || known.has(variant.imageUrl)) continue;
    if (!isPackamProductImageUrl(variant.imageUrl, process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME)) return { ok: false, status: 400, error: "Choose a PackAM photo for each variant." };
    const image = await verifyProductImageForSave(variant.imageUrl);
    if (!image.ok) return { ok: false, status: image.status, error: image.error };
  }

  try {
    return await retrySerializable(() => db.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
          status: true, customerPrice: true,
          options: { select: { id: true, values: { select: { id: true } } } },
          variants: { select: { id: true, optionKey: true, values: { select: { optionValue: { select: { value: true, option: { select: { name: true } } } } } }, _count: { select: { orderItems: true, cartItems: true } } } },
        },
      });
      if (!product) return { ok: false as const, status: 404, error: "Product not found." };

      // 1. Option groups and values: update known ones, create new ones. Payload keys -> real ids.
      const realId = new Map<string, string>();
      const keptOptions = new Set<string>();
      const keptValues = new Set<string>();
      const existingOptions = new Map(product.options.map((option) => [option.id, new Set(option.values.map((value) => value.id))]));
      // Free up names first so swapping two names can't trip the unique index mid-update.
      for (const option of product.options) await tx.productOption.update({ where: { id: option.id }, data: { name: `~${option.id}` } });
      for (const option of product.options) for (const value of option.values) await tx.productOptionValue.update({ where: { id: value.id }, data: { value: `~${value.id}` } });
      for (const [position, option] of setup.options.entries()) {
        const optionId = existingOptions.has(option.key)
          ? (await tx.productOption.update({ where: { id: option.key }, data: { name: option.name, position }, select: { id: true } })).id
          : (await tx.productOption.create({ data: { productId, name: option.name, position }, select: { id: true } })).id;
        keptOptions.add(optionId);
        for (const [valuePosition, value] of option.values.entries()) {
          const owned = existingOptions.get(optionId)?.has(value.key);
          const valueId = owned
            ? (await tx.productOptionValue.update({ where: { id: value.key }, data: { value: value.value, position: valuePosition }, select: { id: true } })).id
            : (await tx.productOptionValue.create({ data: { optionId, value: value.value, position: valuePosition }, select: { id: true } })).id;
          realId.set(value.key, valueId);
          keptValues.add(valueId);
        }
      }

      // 2. Variants: match by combination; anything left over is removed, unless it has history.
      const wanted = new Map(setup.variants.map((variant) => [optionKeyFor(variant.valueKeys.map((key) => realId.get(key)!)), variant]));
      for (const variant of product.variants) {
        if (wanted.has(variant.optionKey)) continue;
        if (variant._count.orderItems || variant._count.cartItems) {
          const label = describeOptions(variant.values.map((value) => ({ name: value.optionValue.option.name, value: value.optionValue.value })));
          throw new KeepVariantError(`${label} has been ordered or is in a student’s cart, so it can’t be removed. Mark it unavailable instead.`);
        }
        await tx.productVariant.delete({ where: { id: variant.id } });
      }
      const byKey = new Map(product.variants.map((variant) => [variant.optionKey, variant.id]));
      for (const [optionKey, variant] of wanted) {
        const data = { price: variant.price, stockQuantity: variant.stockQuantity, sku: variant.sku, status: variant.active ? "ACTIVE" as const : "INACTIVE" as const, imageUrl: variant.imageUrl };
        const existingId = byKey.get(optionKey);
        if (existingId) await tx.productVariant.update({ where: { id: existingId }, data });
        else await tx.productVariant.create({ data: { ...data, productId, optionKey, values: { create: variant.valueKeys.map((key) => ({ optionValueId: realId.get(key)! })) } } });
      }

      // 3. Remove option values and groups no longer used.
      await tx.productOptionValue.deleteMany({ where: { option: { productId }, id: { notIn: [...keptValues] } } });
      await tx.productOption.deleteMany({ where: { productId, id: { notIn: [...keptOptions] } } });

      // 4. The product's own price follows its cheapest available variant (shown as "From ₦X").
      const active = setup.variants.filter((variant) => variant.active).map((variant) => variant.price);
      if (active.length) await tx.product.update({ where: { id: productId }, data: { customerPrice: Math.min(...active), stockQuantity: null } });
      await writeAuditLog(tx, {
        actorId: adminId, action: "PRODUCT_VARIANTS_UPDATED", resource: "Product", resourceId: productId,
        newState: { options: setup.options.map((option) => ({ name: option.name, values: option.values.map((value) => value.value) })), variants: setup.variants.length, available: active.length },
      });
      return { ok: true as const, variantCount: setup.variants.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof KeepVariantError) return { ok: false, status: 409, error: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && String(error.meta?.target ?? error.message).includes("sku")) {
      return { ok: false, status: 409, error: "One of those SKUs is already used by another product." };
    }
    throw error;
  }
}

class KeepVariantError extends Error {}
