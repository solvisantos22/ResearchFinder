import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const noveltyJobServicePromise = import("@/lib/jobs/novelty-scan");

afterEach(() => {
  mocked.prisma = null;
});

describe("novelty scan persistence", () => {
  it("creates one novelty scan job for a completed inbox generation job", async () => {
    const { createNoveltyScanJobForInboxGeneration } = await noveltyJobServicePromise;

    await withPostgresTestDatabase(async (prisma: PrismaClient) => {
      mocked.prisma = prisma;

      const user = await prisma.user.create({
        data: {
          email: "researcher@example.com",
          profile: {
            create: {
              interestsJson: "[]",
              constraintsJson: "[]",
              preferredOutputsJson: "[]",
              rankingWeightsJson: "{}",
              arxivQuery: "cat:cs.AI",
              keywordsJson: "[\"agent evaluation\"]"
            }
          }
        }
      });
      const candidateBatch = await prisma.candidateBatch.create({
        data: {
          userId: user.id,
          inboxDate: "2026-06-25",
          source: "arxiv",
          query: "cat:cs.AI",
          status: "completed",
          completedAt: new Date()
        }
      });
      const inboxJob = await prisma.inboxGenerationJob.create({
        data: {
          userId: user.id,
          candidateBatchId: candidateBatch.id,
          inboxDate: "2026-06-25",
          status: "completed",
          inputJson: "{}",
          completedAt: new Date()
        }
      });

      const job = await createNoveltyScanJobForInboxGeneration({
        userId: user.id,
        inboxGenerationJobId: inboxJob.id,
        inboxDate: "2026-06-25"
      });
      const duplicate = await createNoveltyScanJobForInboxGeneration({
        userId: user.id,
        inboxGenerationJobId: inboxJob.id,
        inboxDate: "2026-06-25"
      });

      expect(duplicate.id).toBe(job.id);
      expect(job.status).toBe("queued");
    });
  });

  it("claims the oldest queued novelty scan job for the worker user", async () => {
    await withPostgresTestDatabase(async (prisma: PrismaClient) => {
      mocked.prisma = prisma;

      const { claimNextNoveltyScanJob } = await import("@/lib/jobs/novelty-scan");
      const user = await prisma.user.create({ data: { email: "worker@example.com" } });
      const otherUser = await prisma.user.create({ data: { email: "other@example.com" } });
      const inboxJob = await createCompletedInboxJob(prisma, user.id, "2026-06-25");
      const otherInboxJob = await createCompletedInboxJob(prisma, otherUser.id, "2026-06-25");
      const first = await prisma.inboxNoveltyScanJob.create({
        data: {
          userId: user.id,
          inboxGenerationJobId: inboxJob.id,
          inboxDate: "2026-06-25",
          status: "queued",
          inputJson: "{}",
          createdAt: new Date("2026-06-25T10:00:00.000Z")
        }
      });
      await prisma.inboxNoveltyScanJob.create({
        data: {
          userId: otherUser.id,
          inboxGenerationJobId: otherInboxJob.id,
          inboxDate: "2026-06-25",
          status: "queued",
          inputJson: "{}"
        }
      });

      const claimed = await claimNextNoveltyScanJob({
        userId: user.id,
        workerId: "worker-1"
      });

      expect(claimed?.id).toBe(first.id);
      expect(claimed?.status).toBe("running");
      expect(claimed?.claimedByWorkerId).toBe("worker-1");
    });
  });

  it("persists completed novelty scan output and updates generated idea labels", async () => {
    await withPostgresTestDatabase(async (prisma: PrismaClient) => {
      mocked.prisma = prisma;

      const { completeNoveltyScanJob } = await import("@/lib/jobs/novelty-scan");
      const user = await prisma.user.create({ data: { email: "worker@example.com" } });
      const inboxJob = await createCompletedInboxJob(prisma, user.id, "2026-06-25");
      const paper = await prisma.paper.create({
        data: {
          arxivId: "2606.00001",
          title: "Paper title",
          abstract: "Paper abstract",
          url: "https://arxiv.org/abs/2606.00001",
          publishedAt: new Date("2026-06-25T00:00:00.000Z"),
          arxivUpdatedAt: new Date("2026-06-25T00:00:00.000Z"),
          authorsJson: "[\"A. Researcher\"]",
          categoriesJson: "[\"cs.AI\"]"
        }
      });
      const idea = await prisma.generatedIdea.create({
        data: {
          userId: user.id,
          paperId: paper.id,
          inboxGenerationJobId: inboxJob.id,
          inboxDate: "2026-06-25",
          title: "AutoBenchsmith",
          summary: "Generate benchmark items.",
          expandedExplanation: "Expanded.",
          trajectory: "Trajectory.",
          noveltyStatus: "not_checked",
          relevanceScore: 0.9,
          significanceScore: 0.8,
          originalityScore: 0.7,
          feasibilityScore: 0.8,
          overallScore: 0.8,
          scoreExplanationsJson: "{}",
          risksJson: "[]",
          smallestSprint: "Build a pilot.",
          generatedBy: "codex"
        }
      });
      const job = await prisma.inboxNoveltyScanJob.create({
        data: {
          userId: user.id,
          inboxGenerationJobId: inboxJob.id,
          inboxDate: "2026-06-25",
          status: "running",
          claimedByWorkerId: "worker-1",
          inputJson: "{}"
        }
      });

      await completeNoveltyScanJob({
        jobId: job.id,
        workerId: "worker-1",
        output: {
          jobId: job.id,
          generatedForUserId: user.id,
          inboxDate: "2026-06-25",
          scans: [
            {
              generatedIdeaId: idea.id,
              status: "completed",
              label: "crowded",
              confidence: 0.82,
              summary: "Adjacent systems exist.",
              overlapExplanation: "The idea needs a sharper differentiator.",
              queries: ["AutoBenchsmith benchmark generation"],
              adaptersAttempted: ["arxiv"],
              adaptersFailed: [],
              evidence: [
                {
                  sourceType: "arxiv",
                  title: "Related paper",
                  url: "https://arxiv.org/abs/2606.00002",
                  sourceId: "2606.00002",
                  claim: "Related benchmark generation work exists.",
                  overlapLevel: "adjacent",
                  confidence: 0.8
                }
              ]
            }
          ]
        }
      });

      const updatedIdea = await prisma.generatedIdea.findUniqueOrThrow({
        where: { id: idea.id },
        include: { noveltyScans: { include: { evidence: true } } }
      });

      expect(updatedIdea.noveltyStatus).toBe("crowded");
      expect(updatedIdea.noveltyScans[0].evidence[0].sourceId).toBe("2606.00002");
    });
  });
});

async function createCompletedInboxJob(prisma: PrismaClient, userId: string, inboxDate: string) {
  const batch = await prisma.candidateBatch.create({
    data: {
      userId,
      inboxDate,
      source: `arxiv-${crypto.randomUUID()}`,
      query: "cat:cs.AI",
      status: "completed",
      completedAt: new Date()
    }
  });

  return prisma.inboxGenerationJob.create({
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
