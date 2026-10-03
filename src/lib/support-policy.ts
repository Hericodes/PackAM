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
