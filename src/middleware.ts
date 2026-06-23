import { NextResponse, type NextRequest } from "next/server";

import {
  PRIVATE_ACCESS_TOKEN_COOKIE,
  PRIVATE_ACCESS_USER_COOKIE,
  getAccessUserIdForToken,
  getAuthorizedPrivateCookieUserId,
  isPrivateAccessEnabled
} from "./lib/private-access";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30
};

export function middleware(request: NextRequest) {
  const configuredTokens = process.env.APP_ACCESS_TOKENS;

  if (!isPrivateAccessEnabled(configuredTokens)) {
    return NextResponse.next();
  }

  const accessToken = request.nextUrl.searchParams.get("accessToken");

  if (accessToken) {
    const userId = getAccessUserIdForToken(configuredTokens, accessToken);

    if (userId) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.searchParams.delete("accessToken");

      const response = NextResponse.redirect(redirectUrl);
      response.cookies.set(PRIVATE_ACCESS_USER_COOKIE, userId, cookieOptions);
      response.cookies.set(PRIVATE_ACCESS_TOKEN_COOKIE, accessToken, cookieOptions);
      return response;
    }
  }

  const activeUserId = getAuthorizedPrivateCookieUserId(
    configuredTokens,
    request.cookies.get(PRIVATE_ACCESS_USER_COOKIE)?.value,
    request.cookies.get(PRIVATE_ACCESS_TOKEN_COOKIE)?.value
  );

  if (activeUserId) {
    return NextResponse.next();
  }

  return new NextResponse("Not found", { status: 404 });
}

export const config = {
  matcher: ["/inbox/:path*", "/dispatch/:path*", "/jobs/:path*"]
};
