import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { buildPresetProfileData } from "@/lib/profiles/field-presets";
import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

const servicePromise = import("@/lib/jobs/inbox-generation");

describe("inbox generation jobs", () => {
  it("creates one queued inbox generation job per user/date", async () => {
    const { createInboxGenerationJob } = await servicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      try {
        const user = await client.user.create({
          data: { id: "user-1", email: "user-1@example.com", name: "User One" }
        });
        await client.researchProfile.create({
          data: {
            userId: user.id,
            ...buildPresetProfileData("ai_ml")
          }
        });

        const batch = await client.candidateBatch.create({
          data: {
            userId: user.id,
            inboxDate: "2026-06-23",
            source: "arxiv",
            query: "cat:cs.AI",
            status: "completed"
          }
        });

        const first = await createInboxGenerationJob({
          userId: user.id,
          candidateBatchId: batch.id,
          inboxDate: "2026-06-23"
        });
        const second = await createInboxGenerationJob({
          userId: user.id,
          candidateBatchId: batch.id,
          inboxDate: "2026-06-23"
        });

        expect(first.id).toBe(second.id);
        expect(await client.inboxGenerationJob.count()).toBe(1);

        const persisted = await client.inboxGenerationJob.findFirstOrThrow({
          where: { id: first.id }
        });

        expect(persisted.userId).toBe(user.id);
        expect(persisted.candidateBatchId).toBe(batch.id);
        expect(persisted.inboxDate).toBe("2026-06-23");
        expect(persisted.status).toBe("queued");
        expect(JSON.parse(persisted.inputJson)).toEqual({ candidateBatchId: batch.id });
      } finally {
        mocked.prisma = null;
      }
    });
  });
});
