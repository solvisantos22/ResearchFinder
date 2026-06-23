export const PRIVATE_ACCESS_USER_COOKIE = "rf_private_user_id";
export const PRIVATE_ACCESS_TOKEN_COOKIE = "rf_private_access_token";

export type AccessTokenEntry = {
  userId: string;
  token: string;
};

export function parseAccessTokenMap(configuredTokens: string | null | undefined): AccessTokenEntry[] {
  if (!configuredTokens?.trim()) {
    return [];
  }

  return configuredTokens
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const separator = entry.indexOf(":");

      if (separator === -1) {
        return [];
      }

      const userId = entry.slice(0, separator).trim();
      const token = entry.slice(separator + 1).trim();

      if (!userId || !token) {
        return [];
      }

      return [{ userId, token }];
    });
}

export function isPrivateAccessEnabled(configuredTokens: string | null | undefined): boolean {
  return Boolean(configuredTokens?.trim());
}

export function getAccessUserIdForToken(
  configuredTokens: string | null | undefined,
  token: string | null | undefined
): string | null {
  if (!token) {
    return null;
  }

  return parseAccessTokenMap(configuredTokens).find((entry) => entry.token === token)?.userId ?? null;
}

export function getAuthorizedPrivateCookieUserId(
  configuredTokens: string | null | undefined,
  cookieUserId: string | null | undefined,
  cookieToken: string | null | undefined
): string | null {
  if (!cookieUserId || !cookieToken) {
    return null;
  }

  const tokenUserId = getAccessUserIdForToken(configuredTokens, cookieToken);
  return tokenUserId === cookieUserId ? cookieUserId : null;
}

export function isAuthorizedPrivateUser(input: {
  configuredTokens: string | null | undefined;
  requestedUserId: string;
  cookieUserId: string | null | undefined;
  cookieToken: string | null | undefined;
}): boolean {
  if (!isPrivateAccessEnabled(input.configuredTokens)) {
    return true;
  }

  return (
    getAuthorizedPrivateCookieUserId(
      input.configuredTokens,
      input.cookieUserId,
      input.cookieToken
    ) === input.requestedUserId
  );
}
