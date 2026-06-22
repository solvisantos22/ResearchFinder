export function isAuthorizedCronRequest(header: string | null, secret: string) {
  return header === `Bearer ${secret}`;
}
