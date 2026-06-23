import { describe, expect, it } from "vitest";

import { hashWorkerToken, verifyWorkerToken } from "@/lib/jobs/worker-auth";

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
