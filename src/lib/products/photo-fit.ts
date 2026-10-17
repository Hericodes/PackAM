export type PhotoFit = "cover" | "contain";

/** How far a photo's shape may differ from its frame before cropping would cut off too much. */
const COVER_TOLERANCE = 1.18;

/**
 * Chooses how a product photo fills its frame from the two aspect ratios.
 * - "cover": shapes are close (e.g. a 3:2 food shot in a 4:3 card), so filling the frame crops at most
 *   a thin edge.
 * - "contain": shapes differ (tall bottles, square packshots, wide banners), so the whole product stays
 *   visible and the frame is filled by a blurred copy of the same photo instead of empty space.
 */
export function photoFit(naturalWidth: number, naturalHeight: number, frameRatio: number): PhotoFit {
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(frameRatio > 0)) return "contain";
  const difference = (naturalWidth / naturalHeight) / frameRatio;
  return difference <= COVER_TOLERANCE && difference >= 1 / COVER_TOLERANCE ? "cover" : "contain";
}
