export function isEmailVerificationRequired() {
  const configuredValue = process.env.REQUIRE_EMAIL_VERIFICATION;
  if (configuredValue === "true") return true;
  if (configuredValue === "false") return false;
  return process.env.NODE_ENV === "production";
}
