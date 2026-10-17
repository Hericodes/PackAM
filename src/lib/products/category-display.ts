/** How each marketplace category looks to students: one icon and tint, used everywhere. */
export type MediaTone = "butter" | "amber" | "peach" | "cream";
type CategoryDisplay = { icon: string; tint: string; blurb: string; tone: MediaTone };

const DISPLAY: Record<string, CategoryDisplay> = {
  "food-drinks": { icon: "🍔", tint: "#fff1d6", blurb: "Meals, snacks and drinks", tone: "peach" },
  "academic-materials": { icon: "📚", tint: "#e9f1ff", blurb: "Stationery and study supplies", tone: "butter" },
  "everyday-essentials": { icon: "🧴", tint: "#eaf7ee", blurb: "Toiletries and daily needs", tone: "cream" },
  "phones-accessories": { icon: "🔌", tint: "#f1ecff", blurb: "Chargers, cables and earphones", tone: "amber" },
  printing: { icon: "🖨️", tint: "#fff4c7", blurb: "Upload a PDF, we print and deliver", tone: "butter" },
};

const FALLBACK: CategoryDisplay = { icon: "🛍️", tint: "#f3f1ea", blurb: "Campus essentials", tone: "cream" };

/**
 * Illustration for a product with no photo, picked from words in its own name so items in the same
 * category stop sharing one icon. It is an icon, never a stand-in photograph; unmatched names use the
 * category icon. More specific words come first.
 */
const NAME_GLYPHS: [RegExp, string][] = [
  [/\b(exercise|note)\s?books?\b|\bjotters?\b/i, "📒"],
  [/\btext\s?books?\b|\bbooks?\b/i, "📕"],
  [/\b(project|ring|box)?\s?files?\b|\bfolders?\b/i, "📁"],
  [/\b(a4|a3)\b|\bpaper\b|\bsheets?\b/i, "📄"],
  [/\bpens?\b|\bballpoint\b|\bbiro\b/i, "🖊️"],
  [/\bpencils?\b/i, "✏️"],
  [/\bcalculators?\b/i, "🧮"],
  [/\bnoodles?\b|\bindomie\b|\bspaghetti\b/i, "🍜"],
  [/\brice\b|\bmeals?\b|\bjollof\b/i, "🍛"],
  [/\bwater\b/i, "💧"],
  [/\b(soft\s)?drinks?\b|\bsoda\b|\bcoke\b|\bjuice\b/i, "🥤"],
  [/\bbread\b|\bsnacks?\b|\bbiscuits?\b/i, "🥖"],
  [/\bchargers?\b|\bcables?\b|\busb\b/i, "🔌"],
  [/\b(ear|head)phones?\b|\bearbuds?\b/i, "🎧"],
  [/\bpower\s?banks?\b|\bbattery\b/i, "🔋"],
  [/\bsoap\b|\bdetergent\b/i, "🧼"],
  [/\btooth(paste|brush)\b/i, "🪥"],
  [/\btissue\b|\btoilet\s?roll\b/i, "🧻"],
];

export function productGlyph(name: string, category: string | null | undefined) {
  return NAME_GLYPHS.find(([pattern]) => pattern.test(name))?.[1] ?? categoryDisplay(category).icon;
}

const NAME_TO_SLUG: Record<string, string> = {
  "food & drinks": "food-drinks",
  "academic materials": "academic-materials",
  "everyday essentials": "everyday-essentials",
  "phones & accessories": "phones-accessories",
  printing: "printing",
};

export function categoryDisplay(slugOrName: string | null | undefined): CategoryDisplay {
  if (!slugOrName) return FALLBACK;
  const key = slugOrName.trim().toLowerCase();
  return DISPLAY[key] ?? DISPLAY[NAME_TO_SLUG[key] ?? ""] ?? FALLBACK;
}
