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

export function getRunnerAcceptanceTimeoutMinutes(environment: NodeJS.ProcessEnv = process.env) {
  const value = Number(environment.RUNNER_ACCEPTANCE_TIMEOUT_MINUTES ?? "15");
  if (!Number.isInteger(value) || value < 1 || value > 1440) return 15;
  return value;
}
