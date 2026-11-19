export function billingIntervalDays(interval: number | string): number {
  const days = Number(interval);
  return Number.isSafeInteger(days) && days > 0 ? days : 0;
}

export function billingIntervalLabel(interval: number | string): string {
  return `${billingIntervalDays(interval)} days`;
}
