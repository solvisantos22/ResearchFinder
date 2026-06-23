import { cookies } from "next/headers";

import {
  PRIVATE_ACCESS_TOKEN_COOKIE,
  PRIVATE_ACCESS_USER_COOKIE,
  getAuthorizedPrivateCookieUserId,
  isPrivateAccessEnabled
} from "@/lib/private-access";

export function isPrivateAccessConfigured(): boolean {
  return isPrivateAccessEnabled(process.env.APP_ACCESS_TOKENS);
}

export async function getActivePrivateUserId(): Promise<string | null> {
  if (!isPrivateAccessConfigured()) {
    return null;
  }

  const cookieStore = await cookies();
  return getAuthorizedPrivateCookieUserId(
    process.env.APP_ACCESS_TOKENS,
    cookieStore.get(PRIVATE_ACCESS_USER_COOKIE)?.value,
    cookieStore.get(PRIVATE_ACCESS_TOKEN_COOKIE)?.value
  );
}

export async function canAccessPrivateUser(requestedUserId: string): Promise<boolean> {
  if (!isPrivateAccessConfigured()) {
    return true;
  }

  return (await getActivePrivateUserId()) === requestedUserId;
}

export async function getRequestUserIdForPrivateAccess(
  fallbackUserId: string | null | undefined
): Promise<string | null> {
  if (!isPrivateAccessConfigured()) {
    return fallbackUserId || null;
  }

  return getActivePrivateUserId();
}
