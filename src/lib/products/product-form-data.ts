import "server-only";

import { db } from "../db";
import { FOOD_CATEGORY } from "./catalogue";

/** Categories (with their subcategories) and labels for the admin product form. Food menus are managed in Admin → Food. */
export async function loadProductFormOptions() {
  const [categories, labels] = await Promise.all([
    db.category.findMany({
      where: { isActive: true, slug: { not: FOOD_CATEGORY.slug } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, subcategories: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } } },
    }),
    db.productLabel.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  return { categories, labels };
}
