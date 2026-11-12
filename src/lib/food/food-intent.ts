/**
 * Does this text ask for cooked food? Students sometimes type "jollof rice and chicken" into a product request or the
 * shop search, when food is ordered straight from a campus food shop (/food). This spots that so PackAM can point
 * them there. It only suggests: the student can still send a request for something that isn't food.
 *
 * Pure and safe in the browser. Matching is on whole words, ignoring case; kitchen things ("rice cooker", "food flask",
 * "plates") don't count.
 */

/** Meals, swallows, soups and other things food shops cook, as students write them. */
const FOOD_WORDS = [
  // Meals and staples
  "food", "meal", "meals", "lunch", "breakfast", "dinner", "supper", "plate of", "a plate", "buka", "mama put", "takeaway",
  "rice", "jollof", "fried rice", "white rice", "ofada", "coconut rice", "native rice", "spaghetti", "jollof spaghetti", "macaroni",
  "beans", "ewa", "agoyin", "ewa agoyin", "porridge", "yam porridge", "asaro", "moi moi", "moimoi", "moin moin", "akara", "dodo", "plantain",
  "boiled yam", "fried yam", "yam and egg", "egg sauce", "abacha", "ugba", "nkwobi", "isi ewu", "asun", "suya", "shawarma", "burger", "pizza",
  "noodles and egg", "indomie and egg", "cooked indomie", "chips", "fries",
  // Swallows
  "swallow", "amala", "eba", "fufu", "semo", "semovita", "pounded yam", "poundo", "iyan", "wheat meal", "lafun", "starch", "tuwo",
  // Soups and stews
  "soup", "stew", "egusi", "efo", "efo riro", "ewedu", "gbegiri", "ogbono", "okra", "okro", "afang", "edikaikong", "banga", "oha", "bitterleaf",
  "pepper soup", "fisherman soup", "vegetable soup", "ayamase", "designer stew",
  // Proteins as people order them with food
  "chicken", "turkey", "goat meat", "beef", "ponmo", "kpomo", "shaki", "assorted", "fried fish", "titus", "croaker", "panla",
] as const;

/** Things that contain a food word but are bought from a shop, not cooked: never a reason to suggest Food. */
const NOT_FOOD = [
  "rice cooker", "food flask", "food warmer", "food container", "food storage", "lunch box", "lunchbox", "plates", "plate set", "hot plate",
  "soup bowl", "soup spoon", "stew pot", "chicken feed", "fish feed", "pet food", "dog food", "cat food", "food colour", "food color",
  "bag of rice", "rice bag", "spaghetti pack", "pack of spaghetti", "carton of", "starch powder", "laundry starch",
] as const;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
const wordPattern = (words: readonly string[]) => new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${[...words].sort((a, b) => b.length - a.length).map(escape).join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu");
const FOOD = wordPattern(FOOD_WORDS);
const EXCLUDED = wordPattern(NOT_FOOD);

/** True when any of the texts reads like a request for cooked food (and isn't a kitchen or pantry item). */
export function looksLikeFood(...texts: Array<string | null | undefined>): boolean {
  const text = texts.filter(Boolean).join(" \n ").slice(0, 1_000);
  if (!text.trim()) return false;
  // A kitchen or pantry phrase is removed first, so "rice cooker" alone isn't food but "rice cooker and jollof" still is.
  const remaining = text.replace(new RegExp(EXCLUDED.source, "giu"), " ");
  return FOOD.test(remaining);
}
