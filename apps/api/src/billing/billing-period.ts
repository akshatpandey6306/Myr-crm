const DAY_MS = 24 * 60 * 60 * 1000;

export function billingIntervalDays(interval: unknown): number | null {
  const days = typeof interval === 'number' ? interval : typeof interval === 'string' ? Number(interval) : NaN;
  return Number.isSafeInteger(days) && days >= 1 && days <= 3650 ? days : null;
}

export function billingPeriodEnd(from: Date, interval: unknown): Date | null {
  const days = billingIntervalDays(interval);
  return days === null ? null : new Date(from.getTime() + days * DAY_MS);
}
