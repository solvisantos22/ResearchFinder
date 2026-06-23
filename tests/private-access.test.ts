import { describe, expect, it } from "vitest";

import {
  getAccessUserIdForToken,
  isAuthorizedPrivateUser,
  isPrivateAccessEnabled,
  parseAccessTokenMap
} from "@/lib/private-access";

describe("private access helpers", () => {
  it("parses APP_ACCESS_TOKENS user-to-token pairs", () => {
    expect(parseAccessTokenMap("demo-solvi:secret-1, demo-collaborator: secret-2")).toEqual([
      { userId: "demo-solvi", token: "secret-1" },
      { userId: "demo-collaborator", token: "secret-2" }
    ]);
  });

  it("maps a valid access token to its user id", () => {
    expect(getAccessUserIdForToken("demo-solvi:secret-1,demo-collaborator:secret-2", "secret-2"))
      .toBe("demo-collaborator");
    expect(getAccessUserIdForToken("demo-solvi:secret-1", "wrong")).toBeNull();
  });

  it("authorizes a requested user only when cookies match a configured token mapping", () => {
    const configuredTokens = "demo-solvi:secret-1,demo-collaborator:secret-2";

    expect(
      isAuthorizedPrivateUser({
        configuredTokens,
        requestedUserId: "demo-solvi",
        cookieUserId: "demo-solvi",
        cookieToken: "secret-1"
      })
    ).toBe(true);
    expect(
      isAuthorizedPrivateUser({
        configuredTokens,
        requestedUserId: "demo-collaborator",
        cookieUserId: "demo-solvi",
        cookieToken: "secret-1"
      })
    ).toBe(false);
    expect(
      isAuthorizedPrivateUser({
        configuredTokens,
        requestedUserId: "demo-solvi",
        cookieUserId: "demo-solvi",
        cookieToken: "wrong"
      })
    ).toBe(false);
  });

  it("keeps local development mode disabled when APP_ACCESS_TOKENS is empty", () => {
    expect(isPrivateAccessEnabled(undefined)).toBe(false);
    expect(isPrivateAccessEnabled("")).toBe(false);
    expect(
      isAuthorizedPrivateUser({
        configuredTokens: "",
        requestedUserId: "any-user",
        cookieUserId: undefined,
        cookieToken: undefined
      })
    ).toBe(true);
  });
});
