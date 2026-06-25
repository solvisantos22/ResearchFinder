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

async function seedCompletedInbox(client: PrismaClient, userId: string, inboxDate: string) {
  const batch = await client.candidateBatch.create({
    data: {
      userId,
      inboxDate,
      source: `arxiv-${inboxDate}`,
      query: "cat:cs.AI",
      status: "completed",
      completedAt: new Date()
    }
  });
  await client.inboxGenerationJob.create({
    data: {
      userId,
      candidateBatchId: batch.id,
      inboxDate,
      status: "completed",
      inputJson: "{}",
      completedAt: new Date()
    }
  });
}

describe("listInboxDatesForUser", () => {
  it("returns distinct inbox dates newest-first", async () => {
    const { listInboxDatesForUser } = await import("@/lib/jobs/inbox-generation");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "dates@example.com" } });
      await seedCompletedInbox(client, user.id, "2026-06-23");
      await seedCompletedInbox(client, user.id, "2026-06-25");
      await seedCompletedInbox(client, user.id, "2026-06-24");

      expect(await listInboxDatesForUser(user.id)).toEqual([
        "2026-06-25",
        "2026-06-24",
        "2026-06-23"
      ]);
    });
  });
});
