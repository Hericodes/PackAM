/**
 * Named campus delivery points offered as suggestions while a student types a location.
 *
 * Maintained by PackAM operations. Rules:
 * - Add only places operations has confirmed exist and that runners can find. Set `verified: true`
 *   only after a runner or staff member has checked it on the ground; unverified entries are shown
 *   as "Suggested", never as verified.
 * - Names only. Deliberately no coordinates: a suggestion fills in the written location, and a GPS
 *   pin only ever comes from the student's own phone, so the runner view's "GPS pin" stays truthful.
 * - `aliases` are what students actually type (e.g. "Hall C", "the chapel").
 *
 * The list ships empty because PackAM has no confirmed campus dataset yet; with no entries, the
 * location form simply has no suggestions and works as free-text entry.
 */
export type CampusPlaceKind = "HOSTEL" | "FACULTY" | "LECTURE_THEATRE" | "GATE" | "LANDMARK" | "OTHER";

export type CampusPlace = {
  name: string;
  kind: CampusPlaceKind;
  /** Campus or area, e.g. "Main campus". Shown with the name and included in the written location. */
  area?: string;
  aliases?: string[];
  verified: boolean;
};

export const CAMPUS_PLACES: CampusPlace[] = [];
