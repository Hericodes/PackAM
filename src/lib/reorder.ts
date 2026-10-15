/** Wording for "Order again": always say what was added and what wasn't. Prices are current prices. */
export type ReorderResult = { name: string; added: boolean };

export function summariseReorder(results: readonly ReorderResult[]) {
  const added = results.filter((result) => result.added);
  const skipped = results.filter((result) => !result.added).map((result) => result.name);
  if (!results.length) return { added: 0, message: "There was nothing to add from this order." };
  if (!added.length) {
    return { added: 0, message: `None of these items are available right now${skipped.length ? ` (${listNames(skipped)})` : ""}. You can request them instead.` };
  }
  const base = added.length === results.length
    ? `Added all ${added.length} item${added.length === 1 ? "" : "s"} to your cart at today’s prices.`
    : `Added ${added.length} of ${results.length} items to your cart at today’s prices.`;
  return { added: added.length, message: skipped.length ? `${base} Not available now: ${listNames(skipped)}.` : base };
}

function listNames(names: string[]) {
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}
