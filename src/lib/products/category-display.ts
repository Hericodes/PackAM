/** How each marketplace category looks to students: one icon and tint, used everywhere. */
type CategoryDisplay = { icon: string; tint: string; blurb: string };

const DISPLAY: Record<string, CategoryDisplay> = {
  "food-drinks": { icon: "🍔", tint: "#fff1d6", blurb: "Meals, snacks and drinks" },
  "academic-materials": { icon: "📚", tint: "#e9f1ff", blurb: "Stationery and study supplies" },
  "everyday-essentials": { icon: "🧴", tint: "#eaf7ee", blurb: "Toiletries and daily needs" },
  "phones-accessories": { icon: "🔌", tint: "#f1ecff", blurb: "Chargers, cables and earphones" },
  printing: { icon: "🖨️", tint: "#fff4c7", blurb: "Upload a PDF, we print and deliver" },
};

const FALLBACK: CategoryDisplay = { icon: "🛍️", tint: "#f3f1ea", blurb: "Campus essentials" };

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
