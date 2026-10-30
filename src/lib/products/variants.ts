/**
 * Product options and variants. Pure, so the combination rules, admin validation and the storefront's
 * "what can still be chosen" logic are unit-tested; the server applies the same rules.
 *
 * Nothing here is built in: option names (Colour, Size, Temperature…) and values are whatever an admin
 * configures for each product.
 */
import { isValidCustomerPrice } from "../catalogue-permissions";

export const MAX_OPTIONS = 3;
export const MAX_VALUES_PER_OPTION = 20;
export const MAX_VARIANTS = 100;
const NAME_MAX = 40;
const SKU_MAX = 64;

/** One variant per combination: its option-value ids, sorted and joined. */
export function optionKeyFor(valueIds: string[]) {
  return [...valueIds].sort().join("|");
}

/** Every combination of one value from each option, in option order. Options without values are skipped. */
export function generateCombinations<T>(options: Array<{ values: T[] }>): T[][] {
  const groups = options.filter((option) => option.values.length > 0);
  if (!groups.length) return [];
  return groups.reduce<T[][]>((combos, option) => combos.flatMap((combo) => option.values.map((value) => [...combo, value])), [[]]);
}

// ---------------------------------------------------------------- admin setup

/** As the admin editor sends it. `key` is an existing id or a temporary key for something new. */
export type VariantSetupInput = {
  options: Array<{ key: string; name: string; values: Array<{ key: string; value: string }> }>;
  variants: Array<{ valueKeys: string[]; price: number; stockQuantity: number | null; sku: string | null; active: boolean; imageUrl: string | null }>;
};

type SetupResult = { ok: true; data: VariantSetupInput } | { ok: false; error: string };

const clean = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");

/**
 * Validates a product's whole option and variant setup. Every variant must pick exactly one value from each
 * option, no two variants may be the same combination, prices are whole naira of at least ₦1, and stock is
 * blank (not tracked) or a whole number of at least 0. An empty setup means a simple product.
 */
export function parseVariantSetup(body: unknown): SetupResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid options." };
  const raw = body as { options?: unknown; variants?: unknown };
  if (!Array.isArray(raw.options) || !Array.isArray(raw.variants)) return { ok: false, error: "Invalid options." };
  if (raw.options.length > MAX_OPTIONS) return { ok: false, error: `Use up to ${MAX_OPTIONS} option groups.` };

  const options: VariantSetupInput["options"] = [];
  const optionNames = new Set<string>();
  const valueOwner = new Map<string, number>();
  for (const [index, entry] of raw.options.entries()) {
    const option = entry as { key?: unknown; name?: unknown; values?: unknown };
    const name = clean(option?.name);
    if (!name) return { ok: false, error: `Option group ${index + 1} needs a name, like Colour or Size.` };
    if (name.length > NAME_MAX) return { ok: false, error: `“${name.slice(0, 20)}…” is too long for an option name.` };
    if (optionNames.has(name.toLowerCase())) return { ok: false, error: `There are two option groups called “${name}”.` };
    optionNames.add(name.toLowerCase());
    if (typeof option.key !== "string" || !option.key) return { ok: false, error: "Invalid options." };
    if (!Array.isArray(option.values) || option.values.length === 0) return { ok: false, error: `Add at least one value to “${name}”.` };
    if (option.values.length > MAX_VALUES_PER_OPTION) return { ok: false, error: `“${name}” can have up to ${MAX_VALUES_PER_OPTION} values.` };
    const seen = new Set<string>();
    const values: Array<{ key: string; value: string }> = [];
    for (const item of option.values as Array<{ key?: unknown; value?: unknown }>) {
      const value = clean(item?.value);
      if (!value) return { ok: false, error: `“${name}” has an empty value.` };
      if (value.length > NAME_MAX) return { ok: false, error: `“${value.slice(0, 20)}…” is too long for a value.` };
      if (seen.has(value.toLowerCase())) return { ok: false, error: `“${name}” lists “${value}” twice.` };
      seen.add(value.toLowerCase());
      if (typeof item.key !== "string" || !item.key || valueOwner.has(item.key)) return { ok: false, error: "Invalid options." };
      valueOwner.set(item.key, index);
      values.push({ key: item.key, value });
    }
    options.push({ key: option.key, name, values });
  }

  if (!options.length) {
    if (raw.variants.length) return { ok: false, error: "Variants need at least one option group." };
    return { ok: true, data: { options: [], variants: [] } };
  }
  if (raw.variants.length === 0) return { ok: false, error: "Add at least one variant, or remove the options to sell it as a simple product." };
  if (raw.variants.length > MAX_VARIANTS) return { ok: false, error: `Use up to ${MAX_VARIANTS} variants.` };

  const variants: VariantSetupInput["variants"] = [];
  const combos = new Set<string>();
  const skus = new Set<string>();
  for (const entry of raw.variants as Array<Record<string, unknown>>) {
    const valueKeys = Array.isArray(entry?.valueKeys) ? entry.valueKeys.filter((key): key is string => typeof key === "string") : [];
    const covered = new Set(valueKeys.map((key) => valueOwner.get(key)));
    if (valueKeys.length !== options.length || covered.size !== options.length || covered.has(undefined)) {
      return { ok: false, error: "Each variant needs exactly one value from every option group." };
    }
    const label = describeOptions(options.map((option) => ({ name: option.name, value: option.values.find((value) => valueKeys.includes(value.key))!.value })));
    const combo = optionKeyFor(valueKeys);
    if (combos.has(combo)) return { ok: false, error: `${label} is listed twice.` };
    combos.add(combo);
    if (!isValidCustomerPrice(entry.price)) return { ok: false, error: `${label}: set a price in whole naira, at least ₦1.` };
    const stock = entry.stockQuantity;
    if (stock !== null && stock !== undefined && (typeof stock !== "number" || !Number.isInteger(stock) || stock < 0 || stock > 1_000_000)) {
      return { ok: false, error: `${label}: stock must be a whole number of 0 or more, or left blank if you don’t track it.` };
    }
    const sku = clean(entry.sku) || null;
    if (sku && sku.length > SKU_MAX) return { ok: false, error: `${label}: the SKU is too long.` };
    if (sku && skus.has(sku.toLowerCase())) return { ok: false, error: `SKU “${sku}” is used twice.` };
    if (sku) skus.add(sku.toLowerCase());
    const imageUrl = typeof entry.imageUrl === "string" && entry.imageUrl.trim() ? entry.imageUrl.trim() : null;
    variants.push({ valueKeys, price: entry.price, stockQuantity: typeof stock === "number" ? stock : null, sku, active: entry.active !== false, imageUrl });
  }
  if (!variants.some((variant) => variant.active)) return { ok: false, error: "At least one variant must be available, or hide the whole product instead." };
  return { ok: true, data: { options, variants } };
}

// ---------------------------------------------------------------- storefront

export type ShopVariant = { id: string; price: number; stockQuantity: number | null; active: boolean; valueIds: string[]; imageUrl: string | null };
export type ShopOption = { id: string; name: string; values: Array<{ id: string; value: string }> };

/** A variant a student can buy right now: available, and in stock if stock is tracked. */
export function isBuyable(variant: Pick<ShopVariant, "active" | "stockQuantity">) {
  return variant.active && (variant.stockQuantity === null || variant.stockQuantity > 0);
}

/**
 * For each option, the values that can still lead to a buyable variant given the other choices made so far.
 * A value with no buyable combination is shown disabled.
 */
export function selectableValues(options: ShopOption[], variants: ShopVariant[], selection: Record<string, string>) {
  const result: Record<string, Set<string>> = {};
  for (const option of options) {
    const others = Object.entries(selection).filter(([optionId, valueId]) => optionId !== option.id && valueId);
    result[option.id] = new Set(option.values
      .filter((value) => variants.some((variant) => isBuyable(variant) && variant.valueIds.includes(value.id) && others.every(([, chosen]) => variant.valueIds.includes(chosen))))
      .map((value) => value.id));
  }
  return result;
}

/** The variant matching a complete selection, or null while something is still unchosen. */
export function variantFor(options: ShopOption[], variants: ShopVariant[], selection: Record<string, string>) {
  if (options.some((option) => !selection[option.id])) return null;
  const key = optionKeyFor(options.map((option) => selection[option.id]));
  return variants.find((variant) => optionKeyFor(variant.valueIds) === key) ?? null;
}

/** Why a quantity can't be bought from tracked stock, or null when it can (or stock isn't tracked). */
export function stockShortfall(stock: number | null, quantity: number) {
  if (stock === null) return null;
  if (stock <= 0) return "Out of stock right now.";
  if (quantity > stock) return `Only ${stock} left. Lower the quantity to continue.`;
  return null;
}

/** "From ₦X" pricing for cards: the cheapest buyable variant, and whether prices differ. */
export function priceRange(variants: Array<Pick<ShopVariant, "price" | "active" | "stockQuantity">>) {
  const buyable = variants.filter(isBuyable);
  const pool = buyable.length ? buyable : variants.filter((variant) => variant.active);
  if (!pool.length) return null;
  const prices = pool.map((variant) => variant.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

// ---------------------------------------------------------------- order and cart lines

export type VariantDetails = { kind: "VARIANT"; variantId: string; sku: string | null; options: Array<{ name: string; value: string }> };

/** "Colour: Black · Size: XL" */
export function describeOptions(options: Array<{ name: string; value: string }>) {
  return options.map((option) => `${option.name}: ${option.value}`).join(" · ");
}

export function parseVariantDetails(value: unknown): VariantDetails | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== "VARIANT" || typeof v.variantId !== "string" || !Array.isArray(v.options)) return null;
  const options = v.options.filter((option): option is { name: string; value: string } => Boolean(option) && typeof (option as { name?: unknown }).name === "string" && typeof (option as { value?: unknown }).value === "string");
  return { kind: "VARIANT", variantId: v.variantId, sku: typeof v.sku === "string" ? v.sku : null, options };
}

/** A stored line's chosen options ("Colour: Black · Size: XL"), or null for a line without options. */
export function optionsText(details: unknown) {
  const parsed = parseVariantDetails(details);
  return parsed && parsed.options.length ? describeOptions(parsed.options) : null;
}

/** The cart line key for a variant, so different variants of a product are separate lines. */
export function variantConfigKey(variantId: string) {
  return `variant:${variantId}`;
}
