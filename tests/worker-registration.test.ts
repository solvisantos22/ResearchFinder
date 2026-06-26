import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

afterEach(() => {
  mocked.prisma = null;
});

describe("registerWorkerForUser", () => {
  it("persists the chosen lane", async () => {
    const { registerWorkerForUser } = await import("@/lib/jobs/worker-registration");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "register@example.com" } });

      const result = await registerWorkerForUser({
        userId: user.id, label: "ResearchFinder Inbox Worker", lane: "inbox"
      });

      const worker = await client.workerRegistration.findUniqueOrThrow({ where: { id: result.workerId } });
      expect(worker.lane).toBe("inbox");
      expect(worker.label).toBe("ResearchFinder Inbox Worker");
      expect(typeof result.token).toBe("string");
    });
  });
});
