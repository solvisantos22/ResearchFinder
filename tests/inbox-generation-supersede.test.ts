import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";

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

async function createCompletedBatch(client: PrismaClient, userId: string, inboxDate: string) {
  const batch = await client.candidateBatch.create({
    data: {
      userId,
      inboxDate,
      source: "arxiv",
      query: "cat:cs.AI",
      status: "completed",
      completedAt: new Date()
    }
  });
  await client.candidatePaper.create({
    data: {
      batchId: batch.id,
      arxivId: `arxiv-${inboxDate}`,
      title: `Paper ${inboxDate}`,
      abstract: "Abstract",
      url: `https://arxiv.org/abs/${inboxDate}`,
      publishedAt: new Date(),
      authorsJson: "[]",
      categoriesJson: "[]",
      rawJson: "{}"
    }
  });
  return batch;
}

async function createInboxJob(
  client: PrismaClient,
  userId: string,
  batchId: string,
  inboxDate: string,
  status: string,
  startedAt: Date | null = null
) {
  return client.inboxGenerationJob.create({
    data: {
      userId,
      candidateBatchId: batchId,
      inboxDate,
      status,
      startedAt,
      inputJson: JSON.stringify({ candidateBatchId: batchId })
    }
  });
}

describe("createInboxGenerationJob backlog suppression", () => {
  it("supersedes older queued and stale-running jobs and leaves the newest claimable", async () => {
    const { createInboxGenerationJob, claimNextInboxGenerationJob } = await import(
      "@/lib/jobs/inbox-generation"
    );
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "backlog@example.com" } });

      const queuedBatch = await createCompletedBatch(client, user.id, "2026-06-20");
      const queuedOld = await createInboxJob(client, user.id, queuedBatch.id, "2026-06-20", "queued");

      const staleBatch = await createCompletedBatch(client, user.id, "2026-06-21");
      const staleOld = await createInboxJob(
        client,
        user.id,
        staleBatch.id,
        "2026-06-21",
        "running",
        new Date(staleRunningJobStartedBefore().getTime() - 60_000)
      );

      const freshBatch = await createCompletedBatch(client, user.id, "2026-06-22");
      const freshRunning = await createInboxJob(
        client,
        user.id,
        freshBatch.id,
        "2026-06-22",
        "running",
        new Date()
      );

      const newBatch = await createCompletedBatch(client, user.id, "2026-06-25");
      const created = await createInboxGenerationJob({
        userId: user.id,
        candidateBatchId: newBatch.id,
        inboxDate: "2026-06-25"
      });

      const reread = async (id: string) =>
        (await client.inboxGenerationJob.findUniqueOrThrow({ where: { id } })).status;

      expect(await reread(queuedOld.id)).toBe("superseded");
      expect(await reread(staleOld.id)).toBe("superseded");
      expect(await reread(freshRunning.id)).toBe("running");
      expect(created.status).toBe("queued");

      const claimed = await claimNextInboxGenerationJob({ userId: user.id, workerId: "w1" });
      expect(claimed?.id).toBe(created.id);
      expect(claimed?.inboxDate).toBe("2026-06-25");
    });
  });
});
