import { describe, expect, it } from "vitest";

import { hashWorkerToken, verifyWorkerToken } from "@/lib/jobs/worker-auth";

describe("worker token hashing", () => {
  it("verifies only the original token", async () => {
    const hash = await hashWorkerToken("secret-token");

    await expect(verifyWorkerToken("secret-token", hash)).resolves.toBe(true);
    await expect(verifyWorkerToken("wrong-token", hash)).resolves.toBe(false);
  });
});
