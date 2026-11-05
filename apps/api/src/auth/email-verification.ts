export function isEmailVerificationRequired() {
  if (process.env.NODE_ENV === "production") return true;
  return process.env.REQUIRE_EMAIL_VERIFICATION === "true";
}
