/**
 * Validation for categories, subcategories and labels in the admin. Pure, so it is unit-tested; the admin
 * API routes apply it on the server.
 */

export function slugify(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export type NamedInput = { name?: string; slug?: string; description?: string | null; sortOrder?: number; isActive?: boolean; imageUrl?: string | null };
type Result = { ok: true; data: NamedInput } | { ok: false; error: string };

/**
 * `creating`: a name is required. Labels have no description or image. Unknown fields are ignored.
 * The slug is derived from the name, so renaming keeps links readable.
 */
export function parseNamedInput(body: unknown, options: { creating: boolean; kind: "Category" | "Subcategory" | "Label"; maxName?: number }): Result {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  const b = body as Record<string, unknown>;
  const data: NamedInput = {};
  const maxName = options.maxName ?? (options.kind === "Label" ? 30 : 80);
  if (options.creating || b.name !== undefined) {
    const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
    if (!name) return { ok: false, error: `Enter a ${options.kind.toLowerCase()} name.` };
    if (name.length > maxName) return { ok: false, error: `Keep the name under ${maxName} characters.` };
    const slug = slugify(name);
    if (!slug) return { ok: false, error: "Use a name with letters or numbers." };
    data.name = name;
    data.slug = slug;
  }
  if (options.kind !== "Label" && b.description !== undefined) {
    if (b.description !== null && typeof b.description !== "string") return { ok: false, error: "Invalid description." };
    const description = typeof b.description === "string" ? b.description.trim() : "";
    if (description.length > 300) return { ok: false, error: "Keep the description under 300 characters." };
    data.description = description || null;
  }
  if (b.sortOrder !== undefined) {
    if (typeof b.sortOrder !== "number" || !Number.isInteger(b.sortOrder) || b.sortOrder < 0 || b.sortOrder > 9999) return { ok: false, error: "Display order must be a whole number from 0 to 9999." };
    data.sortOrder = b.sortOrder;
  }
  if (b.isActive !== undefined) {
    if (typeof b.isActive !== "boolean") return { ok: false, error: "Invalid status." };
    data.isActive = b.isActive;
  }
  if (options.kind === "Category" && b.imageUrl !== undefined) {
    if (b.imageUrl !== null && typeof b.imageUrl !== "string") return { ok: false, error: "Invalid image." };
    data.imageUrl = typeof b.imageUrl === "string" && b.imageUrl.trim() ? b.imageUrl.trim() : null;
  }
  if (!options.creating && !Object.keys(data).length) return { ok: false, error: "Nothing to change." };
  return { ok: true, data };
}

/** Stock for a simple product: blank (not tracked) or a whole number of 0 or more. */
export function parseStockInput(value: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === "" || value === undefined) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) return { ok: false, error: "Stock must be a whole number of 0 or more, or left blank if you don’t track it." };
  return { ok: true, value };
}

/** Label ids from the product form: unique strings, at most 10. */
export function parseLabelIds(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id || id.length > 100)) return { ok: false, error: "Invalid labels." };
  const ids = [...new Set(value as string[])];
  if (ids.length > 10) return { ok: false, error: "Use up to 10 labels per product." };
  return { ok: true, value: ids };
}
