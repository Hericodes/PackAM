export function isPriceIncreaseWithinConfiguredTolerance(
  catalogueUnitPrice: number,
  actualUnitPrice: number,
  environment: Record<string, string | undefined> = process.env,
) {
  const difference = actualUnitPrice - catalogueUnitPrice;
  if (difference <= 0) return true;

  const amountText = environment.PRICE_CHANGE_TOLERANCE_AMOUNT;
  const percentText = environment.PRICE_CHANGE_TOLERANCE_PERCENT;
  if (!amountText && !percentText) return false;

  const amountLimit = amountText ? Number(amountText) : null;
  const percentLimit = percentText ? Number(percentText) : null;
  if (amountLimit !== null && (!Number.isSafeInteger(amountLimit) || amountLimit < 0)) return false;
  if (percentLimit !== null && (!Number.isFinite(percentLimit) || percentLimit < 0)) return false;

  return (amountLimit === null || difference <= amountLimit) &&
    (percentLimit === null || (catalogueUnitPrice > 0 && difference / catalogueUnitPrice * 100 <= percentLimit));
}

/**
 * How long one runner offer stays open (minutes) before it expires and the mission is offered to other
 * runners. It is a per-offer window measured from the offer's `offeredAt`, not an order deadline; see
 * dispatch-policy.ts. Override with RUNNER_ACCEPTANCE_TIMEOUT_MINUTES (1–1440); invalid values use the default.
 */
export const DEFAULT_RUNNER_ACCEPTANCE_TIMEOUT_MINUTES = 30;

export function getRunnerAcceptanceTimeoutMinutes(environment: Record<string, string | undefined> = process.env) {
  const value = Number(environment.RUNNER_ACCEPTANCE_TIMEOUT_MINUTES ?? String(DEFAULT_RUNNER_ACCEPTANCE_TIMEOUT_MINUTES));
  if (!Number.isInteger(value) || value < 1 || value > 1440) return DEFAULT_RUNNER_ACCEPTANCE_TIMEOUT_MINUTES;
  return value;
}
