import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
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

const jobServicePromise = import("@/lib/jobs/inbox-generation");

afterEach(() => {
  mocked.prisma = null;
});

describe("generated inbox persistence", () => {
  it(
    "creates Paper, GeneratedIdea, and IdeaCitation records from GeneratedInboxSchema output",
    async () => {
      const { completeInboxGenerationJob } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const { user, job } = await createRunningInboxGenerationJob(client);
        const output = createGeneratedInbox({
          generatedForUserId: user.id,
          inboxDate: job.inboxDate
        });

        const completedJob = await completeInboxGenerationJob({
          jobId: job.id,
          workerId: "worker-1",
          output
        });

        expect(completedJob.status).toBe("completed");
        expect(JSON.parse(completedJob.outputJson ?? "{}")).toEqual(output);
        expect(completedJob.completedAt).toBeInstanceOf(Date);

        const paper = await client.paper.findUniqueOrThrow({
          where: { arxivId: "2606.00001" }
        });
        expect(paper.title).toBe("Paper 1");
        expect(JSON.parse(paper.authorsJson)).toEqual(["A. Researcher"]);
        expect(JSON.parse(paper.categoriesJson)).toEqual(["cs.AI"]);

        const idea = await client.generatedIdea.findFirstOrThrow({
          where: {
            userId: user.id,
            inboxDate: job.inboxDate,
            paperId: paper.id
          },
          include: { citations: true }
        });

        expect(idea.inboxGenerationJobId).toBe(job.id);
        expect(idea.title).toBe("Idea 1");
        expect(idea.summary).toBe("Summary 1");
        expect(idea.expandedExplanation).toBe("Expanded explanation 1");
        expect(idea.trajectory).toBe("Trajectory 1");
        expect(idea.recommended).toBe(true);
        expect(idea.noveltyStatus).toBe("needs_novelty_check");
        expect(idea.relevanceScore).toBe(0.91);
        expect(idea.significanceScore).toBe(0.82);
        expect(idea.originalityScore).toBe(0.73);
        expect(idea.feasibilityScore).toBe(0.64);
        expect(idea.overallScore).toBe(0.85);
        expect(JSON.parse(idea.scoreExplanationsJson)).toEqual({
          relevance: "Relevance 1",
          significance: "Significance 1",
          originality: "Originality 1",
          feasibility: "Feasibility 1",
          overall: "Overall 1"
        });
        expect(JSON.parse(idea.risksJson)).toEqual(["Risk 1"]);
        expect(idea.smallestSprint).toBe("Sprint 1");
        expect(idea.generatedBy).toBe("codex");

        expect(idea.citations).toHaveLength(2);
        expect(idea.citations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourceType: "paper",
              title: "Paper 1",
              url: "https://arxiv.org/abs/2606.00001",
              sourceId: "2606.00001",
              claim: "Paper claim 1",
              confidence: 0.96
            }),
            expect.objectContaining({
              sourceType: "generated_analysis",
              title: "Generated analysis 1",
              url: "",
              sourceId: null,
              claim: "Generated claim 1",
              confidence: 0.7
            })
          ])
        );
      });
    },
    15000
  );

  it(
    "rejects more than 10 total generated ideas",
    async () => {
      const { completeInboxGenerationJob } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const { user, job } = await createRunningInboxGenerationJob(client);

        await expect(
          completeInboxGenerationJob({
            jobId: job.id,
            workerId: "worker-1",
            output: createGeneratedInbox({
              generatedForUserId: user.id,
              inboxDate: job.inboxDate,
              papers: [
                createPaperGroup(1, 3),
                createPaperGroup(2, 3),
                createPaperGroup(3, 3),
                createPaperGroup(4, 2)
              ]
            })
          })
        ).rejects.toThrow("maximum is 10");

        expect(await client.generatedIdea.count()).toBe(0);
        const persistedJob = await client.inboxGenerationJob.findUniqueOrThrow({
          where: { id: job.id }
        });
        expect(persistedJob.status).toBe("running");
        expect(persistedJob.outputJson).toBeNull();
      });
    },
    15000
  );

  it(
    "returns pending state for an inbox with no generation job",
    async () => {
      const { getGeneratedInboxState } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const user = await client.user.create({
          data: { id: `user-${randomUUID()}`, email: `${randomUUID()}@example.com` }
        });

        await expect(getGeneratedInboxState(user.id, "2026-06-23")).resolves.toEqual({
          status: "pending",
          ideas: []
        });
      });
    },
    15000
  );

  it(
    "does not persist worker output for a different claimed user or date",
    async () => {
      const { completeInboxGenerationJob } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const { job } = await createRunningInboxGenerationJob(client, {
          userId: "claimed-user",
          inboxDate: "2026-06-23"
        });

        await expect(
          completeInboxGenerationJob({
            jobId: job.id,
            workerId: "worker-1",
            output: createGeneratedInbox({
              generatedForUserId: "other-user",
              inboxDate: "2026-06-24"
            })
          })
        ).rejects.toThrow("Generated inbox output does not match claimed job user/date");

        expect(await client.paper.count()).toBe(0);
        expect(await client.generatedIdea.count()).toBe(0);
        expect(await client.ideaCitation.count()).toBe(0);
      });
    },
    15000
  );
});

async function createRunningInboxGenerationJob(
  client: PrismaClient,
  overrides: { userId?: string; inboxDate?: string } = {}
) {
  const user = await client.user.create({
    data: {
      id: overrides.userId ?? `user-${randomUUID()}`,
      email: `${randomUUID()}@example.com`
    }
  });
  const batch = await client.candidateBatch.create({
    data: {
      userId: user.id,
      inboxDate: overrides.inboxDate ?? "2026-06-23",
      source: "arxiv",
      query: "cat:cs.AI",
      status: "completed",
      completedAt: new Date("2026-06-23T12:00:00.000Z")
    }
  });
  const job = await client.inboxGenerationJob.create({
    data: {
      userId: user.id,
      candidateBatchId: batch.id,
      inboxDate: batch.inboxDate,
      status: "running",
      claimedByWorkerId: "worker-1",
      inputJson: JSON.stringify({ candidateBatchId: batch.id }),
      startedAt: new Date("2026-06-23T12:05:00.000Z")
    }
  });

  return { user, batch, job };
}

function createGeneratedInbox(overrides: Record<string, unknown> = {}) {
  return {
    inboxDate: "2026-06-23",
    generatedForUserId: "user-1",
    papers: [createPaperGroup(1, 1)],
    ...overrides
  };
}

function createPaperGroup(paperIndex: number, ideaCount: number) {
  const sourceId = `2606.0000${paperIndex}`;

  return {
    source: "arxiv",
    sourceId,
    title: `Paper ${paperIndex}`,
    abstract: `Abstract ${paperIndex}`,
    url: `https://arxiv.org/abs/${sourceId}`,
    authors: ["A. Researcher"],
    categories: ["cs.AI"],
    publishedAt: "2026-06-23T00:00:00.000Z",
    whyPaperMatters: `Why paper ${paperIndex} matters`,
    ideas: Array.from({ length: ideaCount }, (_, index) =>
      createGeneratedIdea(paperIndex, index + 1, sourceId)
    )
  };
}

function createGeneratedIdea(paperIndex: number, ideaIndex: number, sourceId: string) {
  return {
    title: `Idea ${ideaIndex}`,
    summary: `Summary ${ideaIndex}`,
    expandedExplanation: `Expanded explanation ${ideaIndex}`,
    trajectory: `Trajectory ${ideaIndex}`,
    recommended: ideaIndex === 1,
    noveltyStatus: "needs_novelty_check",
    scores: {
      relevance: 0.91,
      significance: 0.82,
      originality: 0.73,
      feasibility: 0.64,
      overall: 0.85 - ideaIndex * 0.01
    },
    scoreExplanations: {
      relevance: `Relevance ${ideaIndex}`,
      significance: `Significance ${ideaIndex}`,
      originality: `Originality ${ideaIndex}`,
      feasibility: `Feasibility ${ideaIndex}`,
      overall: `Overall ${ideaIndex}`
    },
    risks: [`Risk ${ideaIndex}`],
    smallestViabilitySprint: `Sprint ${ideaIndex}`,
    citations: [
      {
        sourceType: "paper",
        title: `Paper ${paperIndex}`,
        url: `https://arxiv.org/abs/${sourceId}`,
        sourceId,
        claim: `Paper claim ${ideaIndex}`,
        confidence: 0.96
      },
      {
        sourceType: "generated_analysis",
        title: `Generated analysis ${ideaIndex}`,
        url: "",
        claim: `Generated claim ${ideaIndex}`,
        confidence: 0.7
      }
    ]
  };
}
