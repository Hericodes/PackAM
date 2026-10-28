import "server-only";

import { db } from "../db";
import { writeAuditLog } from "../audit";
import { isPackamProductImageUrl } from "../cloudinary-url";
import { FOOD_CATEGORY } from "../products/catalogue";
import { assignSlugs, baseSlug } from "../products/bulk-import";
import { verifyProductImageForSave } from "../products/product-image-server";
import type { MenuItemInput, ShopInput } from "./admin-input";

type StoreResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** A new photo must be a real image in PackAM's image storage; keeping the current one needs no check. */
async function checkImage(url: string | null | undefined, current: string | null): Promise<StoreResult<null>> {
  if (!url || url === current) return { ok: true, data: null };
  if (!isPackamProductImageUrl(url, process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME)) return { ok: false, status: 400, error: "Choose a PackAM photo." };
  const image = await verifyProductImageForSave(url);
  return image.ok ? { ok: true, data: null } : { ok: false, status: image.status, error: image.error };
}

export async function createFoodShop(adminId: string, input: ShopInput): Promise<StoreResult<{ id: string }>> {
  const image = await checkImage(input.imageUrl, null);
  if (!image.ok) return image;
  return db.$transaction(async (tx) => {
    // Starts closed and hidden: an admin adds the menu, then opens and lists it.
    const shop = await tx.vendor.create({
      data: { name: input.name!, type: "RESTAURANT", description: input.description ?? null, location: input.location ?? null, imageUrl: input.imageUrl ?? null, isOpen: false, listedInFood: false },
      select: { id: true },
    });
    await writeAuditLog(tx, { actorId: adminId, action: "FOOD_SHOP_CREATED", resource: "Vendor", resourceId: shop.id, newState: { name: input.name! } });
    return { ok: true as const, data: shop };
  });
}

export async function updateFoodShop(adminId: string, id: string, input: ShopInput): Promise<StoreResult<{ id: string }>> {
  const before = await db.vendor.findUnique({ where: { id }, select: { id: true, name: true, imageUrl: true, isOpen: true, listedInFood: true } });
  if (!before) return { ok: false, status: 404, error: "Shop not found." };
  const image = await checkImage(input.imageUrl, before.imageUrl);
  if (!image.ok) return image;
  return db.$transaction(async (tx) => {
    const updated = await tx.vendor.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.isOpen !== undefined ? { isOpen: input.isOpen } : {}),
        ...(input.listedInFood !== undefined ? { listedInFood: input.listedInFood, ...(input.listedInFood ? { type: "RESTAURANT" as const } : {}) } : {}),
      },
      select: { id: true, name: true, isOpen: true, listedInFood: true },
    });
    await writeAuditLog(tx, {
      actorId: adminId, action: "FOOD_SHOP_UPDATED", resource: "Vendor", resourceId: id,
      previousState: { name: before.name, isOpen: before.isOpen, listedInFood: before.listedInFood },
      newState: { name: updated.name, isOpen: updated.isOpen, listedInFood: updated.listedInFood },
    });
    return { ok: true as const, data: { id } };
  });
}

export async function createMenuItem(adminId: string, shopId: string, input: MenuItemInput): Promise<StoreResult<{ id: string }>> {
  const shop = await db.vendor.findUnique({ where: { id: shopId }, select: { id: true } });
  if (!shop) return { ok: false, status: 404, error: "Shop not found." };
  const image = await checkImage(input.imageUrl, null);
  if (!image.ok) return image;
  return db.$transaction(async (tx) => {
    // Every menu item is filed under the Food category, which Order Stuff never lists or sells.
    const category = await tx.category.upsert({ where: { slug: FOOD_CATEGORY.slug }, update: {}, create: { name: FOOD_CATEGORY.name, slug: FOOD_CATEGORY.slug }, select: { id: true } });
    const base = `food-${baseSlug(input.name!)}`;
    const taken = new Set((await tx.product.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((row) => row.slug));
    const [slug] = assignSlugs([`food ${input.name!}`], taken);
    const item = await tx.product.create({
      data: {
        name: input.name!, slug, categoryId: category.id, shopId, foodRole: input.role!, customerPrice: input.price!,
        menuSection: input.section ?? null, description: input.description ?? null, imageUrl: input.imageUrl ?? null,
        maxPerPlate: input.role === "EXTRA" ? (input.maxPerPlate ?? null) : null,
        // Hidden until the admin marks it available.
        status: input.available ? "ACTIVE" : "INACTIVE",
      },
      select: { id: true },
    });
    await writeAuditLog(tx, { actorId: adminId, action: "PRODUCT_CREATED", resource: "Product", resourceId: item.id, newState: { name: input.name!, shopId, foodRole: input.role!, customerPrice: input.price!, available: Boolean(input.available) } });
    return { ok: true as const, data: item };
  });
}

export async function updateMenuItem(adminId: string, id: string, input: MenuItemInput): Promise<StoreResult<{ id: string }>> {
  const before = await db.product.findUnique({ where: { id }, select: { id: true, shopId: true, foodRole: true, name: true, customerPrice: true, status: true, imageUrl: true } });
  if (!before?.shopId || !before.foodRole) return { ok: false, status: 404, error: "Menu item not found." };
  const image = await checkImage(input.imageUrl, before.imageUrl);
  if (!image.ok) return image;
  return db.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.price !== undefined ? { customerPrice: input.price } : {}),
        ...(input.section !== undefined ? { menuSection: input.section } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.maxPerPlate !== undefined ? { maxPerPlate: before.foodRole === "EXTRA" ? input.maxPerPlate : null } : {}),
        ...(input.available !== undefined ? { status: input.available ? "ACTIVE" as const : "INACTIVE" as const } : {}),
      },
      select: { name: true, customerPrice: true, status: true },
    });
    // Historical orders keep their own frozen names and prices; this changes only the menu from now on.
    await writeAuditLog(tx, {
      actorId: adminId, action: "PRODUCT_UPDATED", resource: "Product", resourceId: id,
      previousState: { name: before.name, customerPrice: before.customerPrice, status: before.status },
      newState: { name: updated.name, customerPrice: updated.customerPrice, status: updated.status },
    });
    return { ok: true as const, data: { id } };
  });
}
