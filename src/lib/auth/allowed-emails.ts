export function parseAllowedGoogleEmails(value = process.env.ALLOWED_GOOGLE_EMAILS ?? "") {
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isAllowedGoogleEmail(
  email: string | null | undefined,
  allowed = parseAllowedGoogleEmails()
) {
  if (!email) return false;
  return allowed.includes(email.trim().toLowerCase());
}
