import { describe, expect, it } from "vitest";

import { hashWorkerToken, readBearerToken, verifyWorkerToken } from "@/lib/jobs/worker-auth";

describe("worker token hashing", () => {
  it("verifies only the original token", async () => {
    const hash = await hashWorkerToken("secret-token");

    await expect(verifyWorkerToken("secret-token", hash)).resolves.toBe(true);
    await expect(verifyWorkerToken("wrong-token", hash)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    const hash = await hashWorkerToken("secret-token");

    await expect(verifyWorkerToken("secret-token", "missing-separator")).resolves.toBe(false);
    await expect(verifyWorkerToken("secret-token", ":hash")).resolves.toBe(false);
    await expect(verifyWorkerToken("secret-token", "salt:")).resolves.toBe(false);
    await expect(verifyWorkerToken("secret-token", `${hash}:extra`)).resolves.toBe(false);
    await expect(verifyWorkerToken("secret-token", "salt:not@base64url")).resolves.toBe(false);
  });
});

describe("bearer token parsing", () => {
  it("returns the token from a valid bearer authorization header", () => {
    expect(readBearerToken(requestWithRawAuthorization("Bearer worker-token"))).toBe(
      "worker-token"
    );
  });

  it("returns null when the authorization header is missing", () => {
    expect(readBearerToken(requestWithRawAuthorization(null))).toBeNull();
  });

  it("returns null for non-bearer authorization", () => {
    expect(readBearerToken(requestWithRawAuthorization("Basic worker-token"))).toBeNull();
  });

  it("returns null for empty or whitespace-only bearer values", () => {
    expect(readBearerToken(requestWithRawAuthorization("Bearer "))).toBeNull();
    expect(readBearerToken(requestWithRawAuthorization("Bearer    "))).toBeNull();
  });
});

function requestWithRawAuthorization(authorization: string | null) {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === "authorization" ? authorization : null)
    }
  } as Request;
}
