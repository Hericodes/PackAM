/**
 * CSV bulk product import: columns, template, and the row-by-row checks. Pure, so every rule is
 * unit-tested; the API runs the same checks on the server against the real categories and products
 * (nothing the browser sends is trusted).
 *
 * The CSV carries only what PackAM's product model has and an admin knows: name, category, price,
 * description and visibility. There are no stock, vendor, variant or image columns: PackAM keeps no
 * stock counts, runners record shops when they buy, and photos are uploaded per product afterwards.
 */
import { csvCell, parseCsv } from "../csv";
import { isValidCustomerPrice } from "../catalogue-permissions";
import { PRODUCT_DESCRIPTION_MAX, PRODUCT_NAME_MAX, parseNairaInput } from "./product-form";

export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 500;

type ColumnKey = "name" | "category" | "price" | "description" | "visibility";

export const IMPORT_COLUMNS: ReadonlyArray<{ key: ColumnKey; required: boolean; aliases: string[]; help: string }> = [
  { key: "name", required: true, aliases: ["product name", "product"], help: `Required. Up to ${PRODUCT_NAME_MAX} characters.` },
  { key: "category", required: true, aliases: ["category name"], help: "Required. An existing category name exactly as in Admin → Categories (e.g. Academic Materials)." },
  { key: "price", required: true, aliases: ["price (ngn)", "price (₦)", "selling price", "customer price"], help: "Required. Whole naira, at least 1. 1500, 1,500 and ₦1,500 all work." },
  { key: "description", required: false, aliases: [], help: `Optional. Up to ${PRODUCT_DESCRIPTION_MAX} characters. Wrap it in quotes if it contains commas.` },
  { key: "visibility", required: false, aliases: ["status"], help: "Optional. hidden (the default) or visible. Hidden products can be checked, given photos and made visible later." },
];

/** Columns we recognise but deliberately don't import. */
const IGNORED_COLUMNS = ["image", "image url", "image_url", "imageurl", "photo", "stock", "quantity", "vendor", "variant"];

export function importTemplate() {
  const notes = [
    "# PackAM product import. Lines starting with # are ignored; delete them or keep them.",
    ...IMPORT_COLUMNS.map((column) => `# ${column.key}: ${column.help}`),
    "# Photos are not imported: after importing, open each product in Admin → Products and upload its photo.",
    `# Up to ${IMPORT_MAX_ROWS} products per file. Products that already exist are skipped, never changed.`,
  ];
  return `${notes.map(csvCell).join("\r\n")}\r\n${IMPORT_COLUMNS.map((column) => column.key).join(",")}\r\n`;
}

export type ImportCategory = { id: string; name: string; slug: string; isActive: boolean };
export type ImportExistingProduct = { id: string; name: string; category: string; customerPrice: number; status: string };

export type ImportRowOutcome = "ready" | "duplicate-in-file" | "exists" | "error";

export type ImportRow = {
  /** The spreadsheet row number (the header counts as a row), so an admin can find it in Excel or Sheets. */
  row: number;
  name: string;
  category: string;
  price: string;
  description: string;
  visibility: string;
  outcome: ImportRowOutcome;
  errors: string[];
  /** Set when the row is ready. */
  product?: { name: string; categoryId: string; categoryName: string; customerPrice: number; description: string | null; status: "ACTIVE" | "INACTIVE" };
  duplicateOfRow?: number;
  existing?: ImportExistingProduct;
};

export type ImportPreview =
  | { ok: false; error: string }
  | { ok: true; rows: ImportRow[]; warnings: string[]; summary: { total: number; ready: number; errors: number; duplicates: number; existing: number } };

const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const headerKey = (value: string) => normalise(value).replace(/^﻿/, "");

export function nameKey(name: string) {
  return normalise(name);
}

/** The products this file could duplicate, for one database lookup. */
export function importLookupNames(rows: ImportRow[]) {
  return [...new Set(rows.map((row) => row.name.trim()).filter(Boolean))];
}

/**
 * Reads the file and checks every row. A row is "ready" only if everything about it is valid, it is
 * the first row with its name in the file, and no product with that name exists yet.
 */
export function previewImport(text: string, categories: ImportCategory[], existing: ImportExistingProduct[]): ImportPreview {
  if (!text.trim()) return { ok: false, error: "The file is empty." };
  const parsed = parseCsv(text);
  if (!parsed.ok) return { ok: false, error: `The file isn’t valid CSV. ${parsed.error}` };

  // Skip notes (#…) and blank lines, keeping each record's spreadsheet row number.
  const records = parsed.rows
    .map((cells, index) => ({ cells, row: index + 1 }))
    .filter(({ cells }) => !(cells[0]?.trim().startsWith("#")) && cells.some((cell) => cell.trim() !== ""));
  const header = records.shift();
  if (!header) return { ok: false, error: "The file has no header row. Start from the template." };

  const columns = new Map<ColumnKey, number>();
  const warnings: string[] = [];
  header.cells.forEach((cell, index) => {
    const key = headerKey(cell);
    const column = IMPORT_COLUMNS.find((entry) => entry.key === key || entry.aliases.includes(key));
    if (column) {
      if (columns.has(column.key)) warnings.push(`The “${column.key}” column appears twice; the first one is used.`);
      else columns.set(column.key, index);
    } else if (key && IGNORED_COLUMNS.includes(key)) {
      warnings.push(`The “${cell.trim()}” column is ignored: ${/image|photo/.test(key) ? "photos are uploaded per product after importing" : "PackAM doesn’t import it"}.`);
    } else if (key) {
      warnings.push(`The “${cell.trim()}” column isn’t a PackAM column and is ignored.`);
    }
  });
  const missing = IMPORT_COLUMNS.filter((column) => column.required && !columns.has(column.key)).map((column) => column.key);
  if (missing.length) return { ok: false, error: `The header row is missing ${missing.join(", ")}. Start from the template; the first row must be: ${IMPORT_COLUMNS.map((column) => column.key).join(",")}` };
  if (!records.length) return { ok: false, error: "The file has a header but no products." };
  if (records.length > IMPORT_MAX_ROWS) return { ok: false, error: `The file has ${records.length} products. Import up to ${IMPORT_MAX_ROWS} at a time — split it into smaller files.` };

  const categoryByKey = new Map<string, ImportCategory>();
  for (const category of categories) {
    categoryByKey.set(normalise(category.name), category);
    categoryByKey.set(normalise(category.slug), category);
  }
  const existingByName = new Map(existing.map((product) => [nameKey(product.name), product]));
  const firstRowByName = new Map<string, number>();
  const value = (cells: string[], key: ColumnKey) => (columns.has(key) ? (cells[columns.get(key)!] ?? "") : "").trim();

  const rows = records.map(({ cells, row }): ImportRow => {
    const fields = { name: value(cells, "name"), category: value(cells, "category"), price: value(cells, "price"), description: value(cells, "description"), visibility: value(cells, "visibility") };
    const errors: string[] = [];
    if (cells.length > header.cells.length) errors.push(`This row has ${cells.length} values but the header has ${header.cells.length} columns. Wrap any value containing a comma in quotes.`);

    if (!fields.name) errors.push("Name is empty.");
    else if (fields.name.length > PRODUCT_NAME_MAX) errors.push(`Name is ${fields.name.length} characters; the limit is ${PRODUCT_NAME_MAX}.`);

    const category = fields.category ? categoryByKey.get(normalise(fields.category)) : undefined;
    if (!fields.category) errors.push("Category is empty.");
    else if (!category) errors.push(`Category “${fields.category}” doesn’t exist. Use one of: ${categories.filter((entry) => entry.isActive).map((entry) => entry.name).join(", ")}.`);
    else if (!category.isActive) errors.push(`Category “${category.name}” is hidden. Activate it in Admin → Categories first, or choose another.`);

    const price = parseNairaInput(fields.price);
    if (price === null) errors.push("Price is empty. Every imported product needs its real selling price.");
    else if (price === "invalid") errors.push(`Price “${fields.price}” isn’t a whole naira amount. Use digits only, like 1500.`);
    else if (!isValidCustomerPrice(price)) errors.push("Price must be at least ₦1.");

    if (fields.description.length > PRODUCT_DESCRIPTION_MAX) errors.push(`Description is ${fields.description.length} characters; the limit is ${PRODUCT_DESCRIPTION_MAX}.`);

    const visibility = normalise(fields.visibility);
    const status = visibility === "visible" || visibility === "active" ? "ACTIVE" : visibility === "" || visibility === "hidden" || visibility === "inactive" ? "INACTIVE" : null;
    if (!status) errors.push(`Visibility “${fields.visibility}” isn’t supported. Use hidden or visible (or leave it empty for hidden).`);

    const base: ImportRow = { row, ...fields, outcome: "error", errors };
    if (errors.length) return base;

    const key = nameKey(fields.name);
    const earlier = firstRowByName.get(key);
    if (earlier !== undefined) return { ...base, outcome: "duplicate-in-file", duplicateOfRow: earlier };
    firstRowByName.set(key, row);
    const found = existingByName.get(key);
    if (found) return { ...base, outcome: "exists", existing: found };
    return {
      ...base,
      outcome: "ready",
      product: { name: fields.name, categoryId: category!.id, categoryName: category!.name, customerPrice: price as number, description: fields.description || null, status: status! },
    };
  });

  const count = (outcome: ImportRowOutcome) => rows.filter((row) => row.outcome === outcome).length;
  return { ok: true, rows, warnings, summary: { total: rows.length, ready: count("ready"), errors: count("error"), duplicates: count("duplicate-in-file"), existing: count("exists") } };
}

/** URL-safe base slug for a product name, matching the products API. */
export function baseSlug(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "product";
}

/** Unique slugs for new products, avoiding every slug already taken. */
export function assignSlugs(names: string[], taken: Set<string>) {
  const used = new Set(taken);
  return names.map((name) => {
    const base = baseSlug(name);
    let slug = base;
    for (let counter = 2; used.has(slug); counter += 1) slug = `${base}-${counter}`;
    used.add(slug);
    return slug;
  });
}
