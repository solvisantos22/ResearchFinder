import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPresetProfileData } from "@/lib/profiles/field-presets";
import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  fetchPapers: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

vi.mock("@/lib/arxiv/client", () => ({
  fetchArxivPapers: (...args: unknown[]) => mocked.fetchPapers(...args)
}));

const jobServicePromise = import("@/lib/jobs/inbox-generation");
const candidateServicePromise = import("@/lib/sources/arxiv-candidates");

afterEach(() => {
  mocked.prisma = null;
  mocked.fetchPapers.mockReset();
});

describe("inbox generation jobs", () => {
  it("creates one queued inbox generation job per user/date", async () => {
    const { createInboxGenerationJob } = await jobServicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

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
    });
  });

  it("keeps concurrent duplicate requests to one persisted job", async () => {
    const { createInboxGenerationJob } = await jobServicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      const { user } = await createProfileOwner(client);
      const batch = await createCandidateBatch(client, user.id);

      const [first, second] = await Promise.all([
        createInboxGenerationJob({
          userId: user.id,
          candidateBatchId: batch.id,
          inboxDate: "2026-06-23"
        }),
        createInboxGenerationJob({
          userId: user.id,
          candidateBatchId: batch.id,
          inboxDate: "2026-06-23"
        })
      ]);

      expect(first.id).toBe(second.id);
      expect(await client.inboxGenerationJob.count()).toBe(1);
    });
  });

  it("rejects a candidate batch owned by another user", async () => {
    const { createInboxGenerationJob } = await jobServicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      const { user: caller } = await createProfileOwner(client);
      const { user: batchOwner } = await createProfileOwner(client);
      const batch = await createCandidateBatch(client, batchOwner.id);

      await expect(
        createInboxGenerationJob({
          userId: caller.id,
          candidateBatchId: batch.id,
          inboxDate: "2026-06-23"
        })
      ).rejects.toThrow("Candidate batch does not belong to this user/date");
      expect(await client.inboxGenerationJob.count()).toBe(0);
    });
  });

  it("rejects a candidate batch for a different inbox date", async () => {
    const { createInboxGenerationJob } = await jobServicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      const { user } = await createProfileOwner(client);
      const batch = await createCandidateBatch(client, user.id, "2026-06-22");

      await expect(
        createInboxGenerationJob({
          userId: user.id,
          candidateBatchId: batch.id,
          inboxDate: "2026-06-23"
        })
      ).rejects.toThrow("Candidate batch does not belong to this user/date");
      expect(await client.inboxGenerationJob.count()).toBe(0);
    });
  });
});

describe("arXiv candidate batches", () => {
  it("reuses an existing completed arxiv batch for the same user/date/source", async () => {
    const { createArxivCandidateBatchForUser } = await candidateServicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user } = await createProfileOwner(client);
      const existingBatch = await createCandidateBatch(client, user.id);

      const first = await createArxivCandidateBatchForUser(user.id, "2026-06-23");
      const second = await createArxivCandidateBatchForUser(user.id, "2026-06-23");

      expect(first.id).toBe(existingBatch.id);
      expect(second.id).toBe(existingBatch.id);
      expect(await client.candidateBatch.count({ where: { userId: user.id } })).toBe(1);
      expect(mocked.fetchPapers).not.toHaveBeenCalled();
    });
  });

  it("deduplicates fetched papers by arxivId before persisting candidates", async () => {
    const { createArxivCandidateBatchForUser } = await candidateServicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user } = await createProfileOwner(client);
      mocked.fetchPapers.mockResolvedValueOnce([
        buildPaperInput("2606.00001", "First duplicate"),
        buildPaperInput("2606.00001", "Second duplicate")
      ]);

      const batch = await createArxivCandidateBatchForUser(user.id, "2026-06-24");

      expect(batch.candidates).toHaveLength(1);
      expect(batch.candidates[0]?.title).toBe("First duplicate");
      expect(await client.candidatePaper.count({ where: { batchId: batch.id } })).toBe(1);
    });
  });
});

async function createProfileOwner(client: PrismaClient) {
  const user = await client.user.create({
    data: { id: `user-${randomUUID()}`, email: `${randomUUID()}@example.com` }
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
      status: "completed"
    }
  });
}

function buildPaperInput(arxivId: string, title: string) {
  return {
    arxivId,
    title,
    abstract: `Abstract for ${title}`,
    url: `https://arxiv.org/abs/${arxivId}`,
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    authors: [`Author for ${title}`],
    categories: ["cs.AI"]
  };
}
