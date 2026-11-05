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

/**
 * How many of one add-on a plate may hold when the admin set no limit: in practice no limit (students add as much
 * beef as they want). It's only a safety ceiling, the same as the cart's per-line quantity, so a stuck button or a
 * crafted request can't make a nonsense order. The database allows exactly this range (CartItemExtra_quantity_check).
 */
export const MAX_EXTRA_QUANTITY = 99;
/** Distinct extras on one plate. Keeps the plate key (and the cart line) bounded. */
export const MAX_DISTINCT_EXTRAS = 12;
/**
 * Different plate items (e.g. Jollof + Fried rice + Beans) on one plate. With 12 extras and a soup the plate key
 * stays under the database's 500-character limit (CartItem_config_key_length_check).
 */
export const MAX_DISTINCT_BASES = 3;
/** Spoons (or wraps) of one plate item: no real limit, the same safety ceiling as add-ons. */
export const MAX_BASE_QUANTITY = 99;

/** What one portion of a plate item is called: wraps of swallow, spoons of everything else. */
export function portionUnit(group: FoodGroup | null | undefined, count = 1) {
  const word = group === "SWALLOW" ? "wrap" : "spoon";
  return count === 1 ? word : `${word}s`;
}
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
  /** EXTRA only: the admin's optional per-plate limit. Null means no limit (MAX_EXTRA_QUANTITY). */
  maxPerPlate: number | null;
  /** BASE and EXTRA: its group, or null/absent for an item made before groups existed. */
  group?: FoodGroup | null;
};

export type LineRequest =
  | { kind: "MEAL"; productId: string; quantity: number }
  | {
      kind: "PLATE";
      /** The plate items and how many spoons (or wraps) of each. */
      bases?: Array<{ productId: string; quantity: number }>;
      /** One spoon of one item: what menus sent before plates could mix items. Used only when `bases` is absent. */
      baseId?: string;
      soupId?: string | null;
      extras?: Array<{ productId: string; quantity: number }>;
      quantity: number;
    };

/** What a priced line is made of, frozen into the payment snapshot and the order. */
export type LineDetails =
  | { kind: "MEAL"; meal: { id: string; name: string; price: number } }
  | {
      kind: "PLATE";
      /** The first plate item (all that plates from before mixing have). */
      base: { id: string; name: string; price: number };
      /** Every plate item with its spoons (or wraps) and their total. Absent on plates from before mixing. */
      bases?: Array<{ id: string; name: string; price: number; quantity: number; total: number }>;
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

/** True when the admin limited this add-on; otherwise students may add as many as they like. */
export function hasExtraLimit(item: Pick<MenuItem, "maxPerPlate">) {
  return item.maxPerPlate !== null && item.maxPerPlate < MAX_EXTRA_QUANTITY;
}

/**
 * The plate key: everything that makes two plates on the same base different. Order-independent, so
 * the same choices always give the same key, and identical plates merge into one cart line.
 */
export function plateConfigKey(soupId: string | null, extras: Array<{ productId: string; quantity: number }>, bases?: Array<{ productId: string; quantity: number }>) {
  const list = (items: Array<{ productId: string; quantity: number }>) => [...items].sort((a, b) => a.productId.localeCompare(b.productId)).map((item) => `${item.productId}x${item.quantity}`).join(",");
  // One spoon of one item keeps the key plates had before mixing, so carts from then still match.
  const basesPart = bases && !(bases.length === 1 && bases[0].quantity === 1) ? `|bases:${list(bases)}` : "";
  return `plate${basesPart}|soup:${soupId ?? "-"}|extras:${list(extras)}`;
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

  // The plate items: several, each with spoons (or wraps); or one spoon of one, from a menu from before mixing.
  const requestedBases = request.bases ?? (request.baseId ? [{ productId: request.baseId, quantity: 1 }] : []);
  if (!Array.isArray(requestedBases) || requestedBases.length === 0) return { ok: false, error: "Choose what you want on your plate." };
  if (requestedBases.length > MAX_DISTINCT_BASES) return { ok: false, error: `Choose up to ${MAX_DISTINCT_BASES} different items for one plate. For more, add another plate.` };
  const bases: Array<{ item: MenuItem; quantity: number }> = [];
  const seenBases = new Set<string>();
  for (const entry of requestedBases) {
    const item = usable(entry?.productId, "BASE");
    if (!item) return { ok: false, error: "Choose your plate from this shop’s menu. One of the items isn’t available right now." };
    if (seenBases.has(item.id)) return { ok: false, error: `${item.name} is listed twice. Set how many ${portionUnit(item.group, 2)} instead.` };
    seenBases.add(item.id);
    if (!isQuantity(entry.quantity, MAX_BASE_QUANTITY)) return { ok: false, error: `Choose how many ${portionUnit(item.group, 2)} of ${item.name} you want, from 1 to ${MAX_BASE_QUANTITY}.` };
    bases.push({ item, quantity: entry.quantity });
  }
  // Swallow goes on its own plate (with its soup); rice and others mix freely.
  const swallow = bases.filter(({ item }) => item.group === "SWALLOW");
  const notSwallow = bases.find(({ item }) => item.group === "RICE" || item.group === "OTHER");
  if (swallow.length && notSwallow) return { ok: false, error: `Swallow comes on its own plate with soup. Put ${notSwallow.item.name} on another plate.` };
  const base = bases[0].item;

  let soup: MenuItem | null = null;
  const rule = swallow.length ? "required" : bases.every(({ item }) => soupRule(item) === "none") ? "none" : "optional";
  if (rule === "none" && request.soupId) return { ok: false, error: `${bases.length > 1 ? "These don’t" : `${base.name} doesn’t`} come with soup. Remove the soup and try again.` };
  if (rule === "required" && !request.soupId) return { ok: false, error: `Choose a soup for your ${swallow.map(({ item }) => item.name).join(" and ")}. Soup is free.` };
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
    if (!isQuantity(entry.quantity, limit)) {
      return { ok: false, error: hasExtraLimit(item)
        ? `You can add ${item.name} up to ${limit} ${limit === 1 ? "time" : "times"} per plate.`
        : `Choose how many ${item.name} you want, from 1 to ${limit} per plate. For more, add another plate.` };
    }
    extras.push({ item, quantity: entry.quantity });
  }

  const basesTotal = bases.reduce((sum, { item, quantity }) => sum + item.price * quantity, 0);
  const unitPrice = basesTotal + (soup?.price ?? 0) + extras.reduce((sum, extra) => sum + extra.item.price * extra.quantity, 0);
  if (!Number.isSafeInteger(unitPrice * request.quantity)) return { ok: false, error: "That plate is too large to price." };
  const simple = bases.length === 1 && bases[0].quantity === 1;
  // The cart line belongs to the first item by id (stable whatever order they were picked in). A mixed or bigger plate
  // also stores every item with its spoons beside the soup and extras; one spoon of one item is stored as before.
  const basesById = [...bases].sort((a, b) => a.item.id.localeCompare(b.item.id));
  const baseRows = bases.map(({ item, quantity }) => ({ productId: item.id, quantity }));
  const extraRows = extras.map((extra) => ({ productId: extra.item.id, quantity: extra.quantity }));
  const stored = [...(simple ? [] : baseRows), ...(soup ? [{ productId: soup.id, quantity: 1 }] : []), ...extraRows];
  return {
    ok: true,
    line: {
      productId: basesById[0].item.id,
      configKey: plateConfigKey(soup?.id ?? null, extraRows, baseRows),
      extras: stored,
      name: bases.map(({ item }) => item.name).join(" + "),
      unitPrice,
      quantity: request.quantity,
      total: unitPrice * request.quantity,
      details: {
        kind: "PLATE",
        base: { id: base.id, name: base.name, price: base.price },
        ...(simple ? {} : { bases: bases.map(({ item, quantity }) => ({ id: item.id, name: item.name, price: item.price, quantity, total: item.price * quantity })) }),
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
    // A mixed or bigger plate stores every item (the line's own included) with its spoons; otherwise it is one spoon of the line's item.
    const baseRows = line.extras.filter((extra) => extra.role === "BASE").map(({ productId, quantity }) => ({ productId, quantity }));
    return {
      kind: "PLATE",
      bases: baseRows.length ? baseRows : [{ productId: line.productId, quantity: 1 }],
      soupId: soup?.productId ?? null,
      extras: line.extras.filter((extra) => extra.role !== "SOUP" && extra.role !== "BASE").map(({ productId, quantity }) => ({ productId, quantity })),
      quantity: line.quantity,
    };
  }
  return { kind: "MEAL", productId: line.productId, quantity: line.quantity };
}

/** One short line describing a plate, for the cart, checkout, order and runner. */
export function describeDetails(details: LineDetails) {
  if (details.kind === "MEAL") return details.meal.name;
  const bases = details.bases ?? [{ ...details.base, quantity: 1, total: details.base.price }];
  const parts = [...bases.map((item) => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name)), ...(details.soup ? [details.soup.name] : []), ...details.extras.map((extra) => (extra.quantity > 1 ? `${extra.name} ×${extra.quantity}` : extra.name))];
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
