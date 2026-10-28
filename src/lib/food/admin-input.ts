/**
 * Validation for Admin → Food. Pure, so every rule is unit-tested; the admin API applies it on the
 * server. Nothing is filled in for the admin: every price, name and role must be set explicitly.
 */
import { isValidCustomerPrice } from "../catalogue-permissions";
import { MAX_EXTRA_QUANTITY, type FoodRole } from "./plate";

export const FOOD_ROLES: readonly FoodRole[] = ["MEAL", "BASE", "SOUP", "EXTRA"];
export const ROLE_LABELS: Record<FoodRole, string> = { MEAL: "Ready-made meal", BASE: "Plate base", SOUP: "Soup", EXTRA: "Extra" };

const NAME_MAX = 120;
const SHORT_MAX = 120;
const DESCRIPTION_MAX = 1000;

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const text = (value: unknown, max: number, label: string, required: boolean): Result<string | null> | undefined => {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === "string" && !value.trim())) return required ? { ok: false, error: `${label} is required.` } : { ok: true, data: null };
  if (typeof value !== "string") return { ok: false, error: `${label} must be text.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, data: trimmed };
};

const flag = (value: unknown, label: string): Result<boolean> | undefined => {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? { ok: true, data: value } : { ok: false, error: `${label} must be on or off.` };
};

export type ShopInput = { name?: string; description?: string | null; location?: string | null; imageUrl?: string | null; isOpen?: boolean; listedInFood?: boolean };

/** `creating`: name is required. Image URLs are checked against image storage separately. */
export function parseShopInput(body: unknown, creating: boolean): Result<ShopInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  const b = body as Record<string, unknown>;
  const data: ShopInput = {};
  const name = text(creating && b.name === undefined ? "" : b.name, NAME_MAX, "Shop name", true);
  if (name && !name.ok) return name;
  if (name?.ok) data.name = name.data!;
  for (const [key, label, max] of [["description", "Description", DESCRIPTION_MAX], ["location", "Location", SHORT_MAX]] as const) {
    const value = text(b[key], max, label, false);
    if (value && !value.ok) return value;
    if (value?.ok) data[key] = value.data;
  }
  if (b.imageUrl !== undefined) {
    if (b.imageUrl !== null && b.imageUrl !== "" && typeof b.imageUrl !== "string") return { ok: false, error: "Invalid photo." };
    data.imageUrl = typeof b.imageUrl === "string" && b.imageUrl.trim() ? b.imageUrl.trim() : null;
  }
  for (const [key, label] of [["isOpen", "Open"], ["listedInFood", "Show in Food"]] as const) {
    const value = flag(b[key], label);
    if (value && !value.ok) return value;
    if (value?.ok) data[key] = value.data;
  }
  if (creating && (data.isOpen || data.listedInFood)) return { ok: false, error: "Create the shop first, add its menu, then open it and show it in Food." };
  return { ok: true, data };
}

export type MenuItemInput = { name?: string; role?: FoodRole; price?: number; section?: string | null; description?: string | null; imageUrl?: string | null; maxPerPlate?: number | null; available?: boolean };

/** `creating`: name, role and price are required. The role of an existing item can't change. */
export function parseMenuItemInput(body: unknown, creating: boolean, existingRole?: FoodRole): Result<MenuItemInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  const b = body as Record<string, unknown>;
  const data: MenuItemInput = {};
  const name = text(creating && b.name === undefined ? "" : b.name, NAME_MAX, "Item name", true);
  if (name && !name.ok) return name;
  if (name?.ok) data.name = name.data!;

  if (creating) {
    if (!FOOD_ROLES.includes(b.role as FoodRole)) return { ok: false, error: "Choose what this item is: a ready-made meal, a plate base, a soup or an extra." };
    data.role = b.role as FoodRole;
  } else if (b.role !== undefined && b.role !== existingRole) {
    return { ok: false, error: "An item’s type can’t be changed. Hide it and add a new item instead." };
  }
  const role = data.role ?? existingRole;

  if (creating || b.price !== undefined) {
    if (!isValidCustomerPrice(b.price)) return { ok: false, error: "Set a price in whole naira, at least ₦1." };
    data.price = b.price;
  }
  for (const [key, label, max] of [["section", "Menu section", SHORT_MAX], ["description", "Description", DESCRIPTION_MAX]] as const) {
    const value = text(b[key], max, label, false);
    if (value && !value.ok) return value;
    if (value?.ok) data[key] = value.data;
  }
  if (b.imageUrl !== undefined) {
    if (b.imageUrl !== null && b.imageUrl !== "" && typeof b.imageUrl !== "string") return { ok: false, error: "Invalid photo." };
    data.imageUrl = typeof b.imageUrl === "string" && b.imageUrl.trim() ? b.imageUrl.trim() : null;
  }
  if (b.maxPerPlate !== undefined && b.maxPerPlate !== null && b.maxPerPlate !== "") {
    if (role !== "EXTRA") return { ok: false, error: "Only extras have a per-plate limit." };
    if (typeof b.maxPerPlate !== "number" || !Number.isInteger(b.maxPerPlate) || b.maxPerPlate < 1 || b.maxPerPlate > MAX_EXTRA_QUANTITY) return { ok: false, error: `The per-plate limit must be from 1 to ${MAX_EXTRA_QUANTITY}.` };
    data.maxPerPlate = b.maxPerPlate;
  } else if (b.maxPerPlate === null || b.maxPerPlate === "") {
    data.maxPerPlate = null;
  }
  const available = flag(b.available, "Available");
  if (available && !available.ok) return available;
  if (available?.ok) data.available = available.data;
  return { ok: true, data };
}
