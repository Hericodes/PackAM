/**
 * Where PackAM delivers: Olabisi Onabanjo University main campus ("Permanent Site"), Ago-Iwoye.
 *
 * The owner chose "main campus grounds only" on 2026-11-07. Students in off-campus hostels in Ago-Iwoye
 * town are outside this area on purpose.
 *
 * Centre: the middle of the campus outline in OpenStreetMap (way 789111299, amenity=university,
 * bounds 6.9142764–6.9294282 N, 3.8659178–3.8769600 E), about 1.7 km north–south by 1.2 km east–west.
 * Its farthest corner is about 1.05 km from the centre, so a 2 km circle covers the whole campus plus
 * about 1 km of slack for phone GPS error at the edges.
 *
 * Change these numbers here only; the locations API, checkout and printing all read them.
 */
export const SERVICE_AREA = {
  name: "Olabisi Onabanjo University",
  shortName: "OOU",
  /** Shown to students, e.g. "PackAM only delivers on OOU main campus, Ago-Iwoye." */
  placeLabel: "OOU main campus, Ago-Iwoye",
  center: { latitude: 6.921852, longitude: 3.871439 },
  radiusMetres: 2_000,
} as const;

export type ServiceArea = {
  name: string;
  shortName: string;
  placeLabel: string;
  center: { latitude: number; longitude: number };
  radiusMetres: number;
};
