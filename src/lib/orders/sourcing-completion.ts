type SourcingState = { status: string; quantity: number };
type SourcingOrderItem = { quantity: number; sourcing: SourcingState[] };

export function hasCompleteSourcing(items: SourcingOrderItem[]) {
  return items.length > 0 && items.every((item) => item.sourcing
    .filter((entry) => entry.status === "SOURCED" || entry.status === "APPROVED")
    .reduce((sum, entry) => sum + entry.quantity, 0) >= item.quantity);
}

export function hasUnresolvedUnavailableItems(items: SourcingOrderItem[]) {
  return items.some((item) => {
    const sourced = item.sourcing.filter((entry) => entry.status === "SOURCED" || entry.status === "APPROVED")
      .reduce((sum, entry) => sum + entry.quantity, 0);
    return sourced < item.quantity && item.sourcing.some((entry) => entry.status === "UNAVAILABLE");
  });
}
