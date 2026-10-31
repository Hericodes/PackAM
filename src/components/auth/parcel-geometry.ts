/**
 * Where the parcel sits in /public/packam-logo.png (500 × 500), measured from the artwork's pixels: the
 * flood-filled cardboard faces plus their black outline and the gripping fist, as a convex polygon outset 2px.
 * Splitting the logo into "everything but this polygon" and "only this polygon" and layering them back
 * reproduces the original exactly, so the success animation can move the parcel without distorting the logo.
 */
export const LOGO_SIZE = 500;

export const PARCEL_POLYGON: ReadonlyArray<readonly [number, number]> = [
  [308.1, 124.5], [315.1, 117.3], [322.2, 112], [333.5, 106.7], [358.4, 96.1], [372, 94], [389.7, 97.1],
  [420.6, 103.8], [432.8, 107], [437.8, 112.2], [442, 138], [444, 153.4], [444.9, 164.7], [438.8, 171.9],
  [378.2, 198], [368.9, 198], [352.3, 191.9], [320.4, 179.2], [313.2, 170.9], [309, 143.1], [308, 127.6],
];

/** The middle of the parcel's top face: where things drop in. */
export const PARCEL_DROP_POINT = [382, 114] as const;
/** The fist holding the parcel: the parcel pivots here so the arm never looks detached. */
export const PARCEL_GRIP_POINT = [325, 150] as const;

const pct = (value: number) => `${((value / LOGO_SIZE) * 100).toFixed(2)}%`;

/** CSS clip-path showing only the parcel. */
export function parcelClipPath() {
  return `polygon(${PARCEL_POLYGON.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(", ")})`;
}

/** CSS mask (SVG data URI) showing everything except the parcel: a full square with the parcel cut out. */
export function logoWithoutParcelMask() {
  const hole = PARCEL_POLYGON.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${LOGO_SIZE} ${LOGO_SIZE}' preserveAspectRatio='none'><path fill='black' fill-rule='evenodd' d='M0 0H${LOGO_SIZE}V${LOGO_SIZE}H0Z ${hole} Z'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** transform-origin for the parcel layer: the grip, as a percentage of the logo box. */
export function gripOrigin() {
  return `${pct(PARCEL_GRIP_POINT[0])} ${pct(PARCEL_GRIP_POINT[1])}`;
}

/** A point of the logo artwork (in 500-px units) in page coordinates, for a logo drawn in `rect`. */
export function logoPointInPage(rect: { left: number; top: number; width: number; height: number }, point: readonly [number, number]) {
  return { x: rect.left + (point[0] / LOGO_SIZE) * rect.width, y: rect.top + (point[1] / LOGO_SIZE) * rect.height };
}
