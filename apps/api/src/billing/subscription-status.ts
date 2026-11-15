export function effectiveSubscriptionStatus(status: string, endsAt: Date | null, now = new Date()) {
  if ((status === "TRIAL" || status === "ACTIVE") && (!endsAt || endsAt <= now)) return "expired";
  return status.toLowerCase();
}
