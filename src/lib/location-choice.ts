/**
 * Choosing and naming delivery locations quickly. Pure, so ordering, defaults, label derivation and
 * place matching are unit-tested. Nothing here changes what is stored or sent to a runner.
 */
import type { CampusPlace, CampusPlaceKind } from "../config/campus-places";

export const LOCATION_LABEL_MAX = 50;

/**
 * A short name for a location when the student doesn't give one: the first part of the written
 * location ("Hostel C, Room 12, near the chapel" → "Hostel C"), so one field is enough.
 */
export function deriveLocationLabel(address: string) {
  const first = address.split(/[,\n]/)[0]?.trim().replace(/\s+/g, " ") ?? "";
  const label = first || address.trim().replace(/\s+/g, " ");
  return label.length > LOCATION_LABEL_MAX ? `${label.slice(0, LOCATION_LABEL_MAX - 1).trimEnd()}…` : label;
}

/** Last-used location first (so it is preselected), then newest saved. Never drops or adds locations. */
export function orderLocationsForCheckout<T extends { id: string }>(locations: T[], lastUsedId: string | null | undefined) {
  if (!lastUsedId) return locations;
  const lastUsed = locations.find((location) => location.id === lastUsedId);
  return lastUsed ? [lastUsed, ...locations.filter((location) => location.id !== lastUsedId)] : locations;
}

/** The student's choice in this browser session wins, then last used, then newest. Stale ids are ignored. */
export function pickInitialLocation<T extends { id: string }>(locations: T[], rememberedId: string | null | undefined) {
  return (rememberedId ? locations.find((location) => location.id === rememberedId) : undefined) ?? locations[0] ?? null;
}

const normalise = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export const CAMPUS_KIND_LABELS: Record<CampusPlaceKind, string> = {
  HOSTEL: "Hostel", FACULTY: "Faculty", LECTURE_THEATRE: "Lecture theatre", GATE: "Gate", LANDMARK: "Landmark", OTHER: "Place",
};

/**
 * Local, instant matching against the operations-maintained campus list: no network request, so
 * there are no stale responses to race. Every query word must match the start of a word in the
 * name, an alias or the area; name matches rank above alias matches.
 */
export function matchCampusPlaces(query: string, places: CampusPlace[], limit = 6) {
  const words = normalise(query).split(" ").filter(Boolean);
  if (!words.length || normalise(query).length < 2) return [];
  const scored: Array<{ place: CampusPlace; score: number }> = [];
  for (const place of places) {
    const nameWords = normalise(place.name).split(" ");
    const otherWords = [...(place.aliases ?? []), place.area ?? "", CAMPUS_KIND_LABELS[place.kind]].flatMap((text) => normalise(text).split(" ")).filter(Boolean);
    let score = 0;
    let matchedAll = true;
    for (const word of words) {
      if (nameWords.some((candidate) => candidate.startsWith(word))) score += 2;
      else if (otherWords.some((candidate) => candidate.startsWith(word))) score += 1;
      else { matchedAll = false; break; }
    }
    if (matchedAll) scored.push({ place, score: score + (place.verified ? 0.5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name)).slice(0, limit).map((entry) => entry.place);
}

/** The written location a suggestion fills in; the student can still add room, floor or gate. */
export function campusPlaceAddress(place: CampusPlace) {
  return place.area ? `${place.name}, ${place.area}` : place.name;
}
