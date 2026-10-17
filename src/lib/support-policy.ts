export const supportStatusTransitions: Record<string, readonly string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["ESCALATED", "RESOLVED"],
  ESCALATED: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function canTransitionSupportCase(from: string, to: string) {
  return from === to || supportStatusTransitions[from]?.includes(to) === true;
}

/** Issue categories a student can pick. Stored as a subject prefix so no schema change is needed. */
export const SUPPORT_CATEGORIES = [
  { value: "MISSING_ITEM", label: "Missing item" },
  { value: "WRONG_ITEM", label: "Wrong item" },
  { value: "DAMAGED_ITEM", label: "Damaged item" },
  { value: "DELIVERY", label: "Delivery problem" },
  { value: "PAYMENT", label: "Payment or refund" },
  { value: "PRINTING", label: "Printing" },
  { value: "ACCOUNT", label: "My account" },
  { value: "OTHER", label: "Something else" },
] as const;

export const SUPPORT_SUBJECT_MIN = 4;
export const SUPPORT_SUBJECT_MAX = 120;

/**
 * Builds the stored subject from a category and an optional short summary.
 * Returns null for an unknown category or a subject that would not fit.
 */
export function supportSubject(category: string, summary: string) {
  const match = SUPPORT_CATEGORIES.find((item) => item.value === category);
  if (!match) return null;
  const trimmed = summary.trim();
  const subject = trimmed ? `${match.label}: ${trimmed}` : match.label;
  return subject.length >= SUPPORT_SUBJECT_MIN && subject.length <= SUPPORT_SUBJECT_MAX ? subject : null;
}

const SUPPORT_STATUS_LABELS: Record<string, string> = {
  OPEN: "Received",
  IN_PROGRESS: "Being looked into",
  ESCALATED: "Escalated",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export function supportStatusLabel(status: string) {
  return SUPPORT_STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}
