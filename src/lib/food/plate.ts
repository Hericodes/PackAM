/**
 * Food menu pricing and plate rules. Pure: the cart API, the payment snapshot and the student menu all
 * use these, so a price can only ever be worked out one way, and every rule is unit-tested.
 *
 * Nothing here is built in: bases, soups and extras are whatever the shop's admin configured.
 */

export type FoodRole = "MEAL" | "BASE" | "SOUP" | "EXTRA";

/**
 * What kind of base or add-on an item is. Bases: SWALLOW (needs a soup), RICE and OTHER (no soup). Add-ons (EXTRA):
 * PROTEIN, SIDE, DRINK. Null for meals and soups, and for items made before groups existed, which keep the old
 * rules (a base without a group takes an optional soup).
 */
export type FoodGroup = "SWALLOW" | "RICE" | "OTHER" | "PROTEIN" | "SIDE" | "DRINK";
export const BASE_GROUPS = ["SWALLOW", "RICE", "OTHER"] as const satisfies readonly FoodGroup[];
export const EXTRA_GROUPS = ["PROTEIN", "SIDE", "DRINK"] as const satisfies readonly FoodGroup[];
export const GROUP_LABELS: Record<FoodGroup, string> = { SWALLOW: "Swallow", RICE: "Rice", OTHER: "Others", PROTEIN: "Protein", SIDE: "Sides", DRINK: "Drinks" };

/** Whether a plate on this base needs a soup ("required": swallow), can't have one ("none") or may ("optional": no group yet). */
export function soupRule(base: { group?: FoodGroup | null }): "required" | "none" | "optional" {
  if (base.group === "SWALLOW") return "required";
  if (base.group === "RICE" || base.group === "OTHER") return "none";
  return "optional";
}

/** Soups may be free (₦0); everything else costs at least ₦1. */
export function isSellablePrice(role: FoodRole, price: number) {
  return Number.isSafeInteger(price) && (price >= 1 || (role === "SOUP" && price === 0));
}

/** "Free" for a ₦0 soup, otherwise "₦1,500". */
export function foodPriceLabel(price: number) {
  return price === 0 ? "Free" : `₦${price.toLocaleString()}`;
}

/** The approved ceiling for one extra on one plate; an admin may set a lower one per extra. */
export const MAX_EXTRA_QUANTITY = 5;
/** Distinct extras on one plate. Keeps the plate key (and the cart line) bounded. */
export const MAX_DISTINCT_EXTRAS = 12;
/** Matches the existing cart rule for any product. */
export const MAX_LINE_QUANTITY = 99;

export type MenuItem = {
  id: string;
  name: string;
  role: FoodRole;
  /** Whole naira. */
  price: number;
  /** ACTIVE, priced and belonging to this shop: the only items a student may choose. */
  available: boolean;
  /** EXTRA only. Null means MAX_EXTRA_QUANTITY. */
  maxPerPlate: number | null;
  /** BASE and EXTRA: its group, or null/absent for an item made before groups existed. */
  group?: FoodGroup | null;
};

export type LineRequest =
  | { kind: "MEAL"; productId: string; quantity: number }
  | { kind: "PLATE"; baseId: string; soupId?: string | null; extras?: Array<{ productId: string; quantity: number }>; quantity: number };

/** What a priced line is made of, frozen into the payment snapshot and the order. */
export type LineDetails =
  | { kind: "MEAL"; meal: { id: string; name: string; price: number } }
  | {
      kind: "PLATE";
      base: { id: string; name: string; price: number };
      soup: { id: string; name: string; price: number } | null;
      extras: Array<{ id: string; name: string; price: number; quantity: number; total: number }>;
    };

export type PricedLine = {
  /** The cart line's product: the meal, or the plate's base. */
  productId: string;
  configKey: string;
  /** Soup and extras to store on the cart line (empty for a meal). */
  extras: Array<{ productId: string; quantity: number }>;
  name: string;
  unitPrice: number;
  quantity: number;
  total: number;
  details: LineDetails;
};

export type LineResult = { ok: true; line: PricedLine } | { ok: false; error: string };

export function extraLimit(item: Pick<MenuItem, "maxPerPlate">) {
  return Math.min(MAX_EXTRA_QUANTITY, item.maxPerPlate ?? MAX_EXTRA_QUANTITY);
}

/**
 * The plate key: everything that makes two plates on the same base different. Order-independent, so
 * the same choices always give the same key, and identical plates merge into one cart line.
 */
export function plateConfigKey(soupId: string | null, extras: Array<{ productId: string; quantity: number }>) {
  const parts = [...extras].sort((a, b) => a.productId.localeCompare(b.productId)).map((extra) => `${extra.productId}x${extra.quantity}`);
  return `plate|soup:${soupId ?? "-"}|extras:${parts.join(",")}`;
}

const isQuantity = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;

/**
 * Prices one cart line against the shop's current menu. Every id must be one of this shop's available
 * items in the right role; anything else is refused with a message a student can act on.
 */
export function priceLine(menu: MenuItem[], request: LineRequest): LineResult {
  const byId = new Map(menu.map((item) => [item.id, item]));
  const usable = (id: unknown, role: FoodRole) => {
    const item = typeof id === "string" ? byId.get(id) : undefined;
    return item && item.role === role && item.available && isSellablePrice(item.role, item.price) ? item : null;
  };
  if (!isQuantity(request.quantity, MAX_LINE_QUANTITY)) return { ok: false, error: `Choose a quantity from 1 to ${MAX_LINE_QUANTITY}.` };

  if (request.kind === "MEAL") {
    const meal = usable(request.productId, "MEAL");
    if (!meal) return { ok: false, error: "That meal isn’t available right now. Pick another one." };
    return {
      ok: true,
      line: {
        productId: meal.id, configKey: "", extras: [], name: meal.name,
        unitPrice: meal.price, quantity: request.quantity, total: meal.price * request.quantity,
        details: { kind: "MEAL", meal: { id: meal.id, name: meal.name, price: meal.price } },
      },
    };
  }

  if (request.kind !== "PLATE") return { ok: false, error: "Choose a meal or build a plate." };
  const base = usable(request.baseId, "BASE");
  if (!base) return { ok: false, error: "Choose a base for your plate from this shop’s menu." };

  let soup: MenuItem | null = null;
  const rule = soupRule(base);
  if (rule === "none" && request.soupId) return { ok: false, error: `${base.name} doesn’t come with soup. Remove the soup and try again.` };
  if (rule === "required" && !request.soupId) return { ok: false, error: `Choose a soup for your ${base.name}. Soup is free.` };
  if (request.soupId) {
    soup = usable(request.soupId, "SOUP");
    if (!soup) return { ok: false, error: "That soup isn’t available right now. Choose another or skip soup." };
  }

  const requested = request.extras ?? [];
  if (!Array.isArray(requested) || requested.length > MAX_DISTINCT_EXTRAS) return { ok: false, error: `Choose up to ${MAX_DISTINCT_EXTRAS} different extras.` };
  const seen = new Set<string>();
  const extras: Array<{ item: MenuItem; quantity: number }> = [];
  for (const entry of requested) {
    const item = usable(entry?.productId, "EXTRA");
    if (!item) return { ok: false, error: "One of your extras isn’t available right now. Remove it and try again." };
    if (seen.has(item.id)) return { ok: false, error: `${item.name} is listed twice. Set its quantity instead.` };
    seen.add(item.id);
    const limit = extraLimit(item);
    if (!isQuantity(entry.quantity, limit)) return { ok: false, error: `You can add ${item.name} up to ${limit} ${limit === 1 ? "time" : "times"} per plate.` };
    extras.push({ item, quantity: entry.quantity });
  }

  const unitPrice = base.price + (soup?.price ?? 0) + extras.reduce((sum, extra) => sum + extra.item.price * extra.quantity, 0);
  if (!Number.isSafeInteger(unitPrice * request.quantity)) return { ok: false, error: "That plate is too large to price." };
  const stored = [...(soup ? [{ productId: soup.id, quantity: 1 }] : []), ...extras.map((extra) => ({ productId: extra.item.id, quantity: extra.quantity }))];
  return {
    ok: true,
    line: {
      productId: base.id,
      configKey: plateConfigKey(soup?.id ?? null, extras.map((extra) => ({ productId: extra.item.id, quantity: extra.quantity }))),
      extras: stored,
      name: base.name,
      unitPrice,
      quantity: request.quantity,
      total: unitPrice * request.quantity,
      details: {
        kind: "PLATE",
        base: { id: base.id, name: base.name, price: base.price },
        soup: soup ? { id: soup.id, name: soup.name, price: soup.price } : null,
        extras: extras.map(({ item, quantity }) => ({ id: item.id, name: item.name, price: item.price, quantity, total: item.price * quantity })),
      },
    },
  };
}

/**
 * Rebuilds the request for a stored cart line (its product plus its soup and extras), so the cart can be
 * re-priced against the current menu at any time.
 */
export function storedLineRequest(line: { productId: string; quantity: number; productRole: FoodRole | null; extras: Array<{ productId: string; quantity: number; role: FoodRole | null }> }): LineRequest {
  if (line.productRole === "BASE") {
    const soup = line.extras.find((extra) => extra.role === "SOUP");
    return { kind: "PLATE", baseId: line.productId, soupId: soup?.productId ?? null, extras: line.extras.filter((extra) => extra.role !== "SOUP").map(({ productId, quantity }) => ({ productId, quantity })), quantity: line.quantity };
  }
  return { kind: "MEAL", productId: line.productId, quantity: line.quantity };
}

/** One short line describing a plate, for the cart, checkout, order and runner. */
export function describeDetails(details: LineDetails) {
  if (details.kind === "MEAL") return details.meal.name;
  const parts = [details.base.name, ...(details.soup ? [details.soup.name] : []), ...details.extras.map((extra) => (extra.quantity > 1 ? `${extra.name} ×${extra.quantity}` : extra.name))];
  return parts.join(" + ");
}

/** Parses order or snapshot details stored as JSON. Null when absent or not a food line. */
export function parseLineDetails(value: unknown): LineDetails | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "MEAL" && v.meal && typeof v.meal === "object") return value as LineDetails;
  if (v.kind === "PLATE" && v.base && typeof v.base === "object" && Array.isArray(v.extras)) return value as LineDetails;
  return null;
}
