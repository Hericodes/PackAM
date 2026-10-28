import "server-only";

import { db } from "../db";
import type { FoodRole, MenuItem } from "./plate";

/**
 * What students may see about a food shop. Selected explicitly so internal vendor fields (phone, notes,
 * reliability score, type) can never reach a student page.
 */
const publicShopSelect = { id: true, name: true, description: true, imageUrl: true, location: true, isOpen: true } as const;

/** A shop students can see: listed for Food by an admin and not deactivated. */
export const listedShopWhere = { listedInFood: true, status: "ACTIVE" as const };

export type PublicMenuItem = MenuItem & { description: string | null; imageUrl: string | null; section: string | null };

export async function listFoodShops() {
  const shops = await db.vendor.findMany({
    where: listedShopWhere,
    orderBy: [{ isOpen: "desc" }, { name: "asc" }],
    select: { ...publicShopSelect, menuItems: { where: { status: "ACTIVE", customerPrice: { gte: 1 } }, select: { menuSection: true, foodRole: true } } },
  });
  return shops.map(({ menuItems, ...shop }) => ({
    ...shop,
    // Highlights come only from what the admin configured: the shop's own menu headings.
    sections: [...new Set(menuItems.map((item) => item.menuSection?.trim()).filter((section): section is string => Boolean(section)))].slice(0, 4),
    hasMeals: menuItems.some((item) => item.foodRole === "MEAL"),
    hasPlates: menuItems.some((item) => item.foodRole === "BASE"),
    itemCount: menuItems.length,
  }));
}

export async function getFoodShop(id: string) {
  if (!id || id.length > 100) return null;
  return db.vendor.findFirst({ where: { id, ...listedShopWhere }, select: publicShopSelect });
}

/** The shop's menu as students see it: only available, priced items. */
export async function getShopMenu(shopId: string): Promise<PublicMenuItem[]> {
  const items = await db.product.findMany({
    where: { shopId, status: "ACTIVE", customerPrice: { gte: 1 }, foodRole: { not: null } },
    orderBy: [{ menuSection: "asc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, imageUrl: true, foodRole: true, customerPrice: true, maxPerPlate: true, menuSection: true },
  });
  return items.map((item) => ({
    id: item.id, name: item.name, role: item.foodRole as FoodRole, price: item.customerPrice, available: true,
    maxPerPlate: item.maxPerPlate, description: item.description, imageUrl: item.imageUrl, section: item.menuSection,
  }));
}
