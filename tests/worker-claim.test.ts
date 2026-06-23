import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPresetProfileData } from "@/lib/profiles/field-presets";
import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

const jobServicePromise = import("@/lib/jobs/inbox-generation");

afterEach(() => {
  mocked.prisma = null;
});

describe("claimNextInboxGenerationJob", () => {
  it("claims the oldest queued inbox generation job for the worker user", async () => {
    const { claimNextInboxGenerationJob } = await jobServicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      const { user } = await createProfileOwner(client, "user-1");
      const olderBatch = await createCandidateBatch(client, user.id, "2026-06-22");
      const newerBatch = await createCandidateBatch(client, user.id, "2026-06-23");
      const olderJob = await createInboxGenerationJob(client, {
        userId: user.id,
        candidateBatchId: olderBatch.id,
        inboxDate: "2026-06-22",
        createdAt: new Date("2026-06-22T00:00:00.000Z")
      });
      const newerJob = await createInboxGenerationJob(client, {
        userId: user.id,
        candidateBatchId: newerBatch.id,
        inboxDate: "2026-06-23",
        createdAt: new Date("2026-06-23T00:00:00.000Z")
      });

      const claimed = await claimNextInboxGenerationJob({
        userId: user.id,
        workerId: "worker-1"
      });

      expect(claimed?.id).toBe(olderJob.id);
      const remaining = await client.inboxGenerationJob.findUniqueOrThrow({
        where: { id: newerJob.id }
      });
      expect(remaining.status).toBe("queued");
    });
  });

  it("does not claim jobs owned by another user", async () => {
    const { claimNextInboxGenerationJob } = await jobServicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      await createProfileOwner(client, "user-1");
      const { user: otherUser } = await createProfileOwner(client, "user-2");
      const otherBatch = await createCandidateBatch(client, otherUser.id);
      const otherJob = await createInboxGenerationJob(client, {
        userId: otherUser.id,
        candidateBatchId: otherBatch.id,
        inboxDate: "2026-06-23",
        createdAt: new Date("2026-06-23T00:00:00.000Z")
      });

      await expect(
        claimNextInboxGenerationJob({
          userId: "user-1",
          workerId: "worker-1"
        })
      ).resolves.toBeNull();

      const persisted = await client.inboxGenerationJob.findUniqueOrThrow({
        where: { id: otherJob.id }
      });
      expect(persisted.status).toBe("queued");
      expect(persisted.claimedByWorkerId).toBeNull();
    });
  });

  it("marks a claimed job running with the claiming worker id", async () => {
    const { claimNextInboxGenerationJob } = await jobServicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      const { user } = await createProfileOwner(client, "user-1");
      const batch = await createCandidateBatch(client, user.id);
      const job = await createInboxGenerationJob(client, {
        userId: user.id,
        candidateBatchId: batch.id,
        inboxDate: "2026-06-23",
        createdAt: new Date("2026-06-23T00:00:00.000Z")
      });

      const claimed = await claimNextInboxGenerationJob({
        userId: user.id,
        workerId: "worker-1"
      });

      expect(claimed?.id).toBe(job.id);
      expect(claimed?.status).toBe("running");
      expect(claimed?.claimedByWorkerId).toBe("worker-1");
      expect(claimed?.startedAt).toBeInstanceOf(Date);

      const persisted = await client.inboxGenerationJob.findUniqueOrThrow({
        where: { id: job.id }
      });
      expect(persisted.status).toBe("running");
      expect(persisted.claimedByWorkerId).toBe("worker-1");
      expect(persisted.startedAt).toBeInstanceOf(Date);
    });
  });
});

async function createProfileOwner(client: PrismaClient, id: string) {
  const user = await client.user.create({
    data: { id, email: `${id}-${randomUUID()}@example.com` }
  });
  await client.researchProfile.create({
    data: {
      userId: user.id,
      ...buildPresetProfileData("ai_ml")
    }
  });

  return { user };
}

async function createCandidateBatch(
  client: PrismaClient,
  userId: string,
  inboxDate = "2026-06-23"
) {
  return client.candidateBatch.create({
    data: {
      userId,
      inboxDate,
      source: "arxiv",
      query: "cat:cs.AI",
      status: "completed",
      completedAt: new Date(`${inboxDate}T12:00:00.000Z`),
      candidates: {
        create: [
          {
            arxivId: `${userId}-${inboxDate}-1`,
            title: `Candidate ${userId} ${inboxDate}`,
            abstract: "Candidate abstract",
            url: `https://arxiv.org/abs/${userId}-${inboxDate}-1`,
            publishedAt: new Date("2026-06-01T00:00:00.000Z"),
            authorsJson: JSON.stringify(["Author"]),
            categoriesJson: JSON.stringify(["cs.AI"]),
            rawJson: JSON.stringify({ id: `${userId}-${inboxDate}-1` }),
            createdAt: new Date(`${inboxDate}T12:01:00.000Z`)
          }
        ]
      }
    }
  });
}

function createInboxGenerationJob(
  client: PrismaClient,
  input: {
    userId: string;
    candidateBatchId: string;
    inboxDate: string;
    createdAt: Date;
  }
) {
  return client.inboxGenerationJob.create({
    data: {
      userId: input.userId,
      candidateBatchId: input.candidateBatchId,
      inboxDate: input.inboxDate,
      status: "queued",
      inputJson: JSON.stringify({ candidateBatchId: input.candidateBatchId }),
      createdAt: input.createdAt
    }
  });
}
