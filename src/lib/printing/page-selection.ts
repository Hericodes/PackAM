import { PRINTING_LIMITS } from "./limits";

export type PageSelection = {
  canonical: string;
  selectedPageCount: number;
};

export function parsePageSelection(value: string, pageCount: number): PageSelection {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PRINTING_LIMITS.pages) {
    throw new Error(`Documents must have between 1 and ${PRINTING_LIMITS.pages} pages.`);
  }
  const input = value.trim().toUpperCase();
  if (input === "ALL") return { canonical: "ALL", selectedPageCount: pageCount };
  if (!input || input.length > 1000) throw new Error("Enter ALL or a valid page list such as 1-5, 8, 10-12.");

  const pages = new Set<number>();
  const canonicalRanges: string[] = [];
  for (const part of input.split(",")) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!match) throw new Error("Use page numbers and ranges like 1-5, 8, 10-12.");
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > pageCount) {
      throw new Error(`Page numbers must be between 1 and ${pageCount}.`);
    }
    for (let page = first; page <= last; page++) {
      if (pages.has(page)) throw new Error("A page cannot appear more than once in the selection.");
      pages.add(page);
    }
    canonicalRanges.push(first === last ? String(first) : `${first}-${last}`);
  }
  if (!pages.size) throw new Error("Select at least one page.");
  return { canonical: canonicalRanges.join(", "), selectedPageCount: pages.size };
}
