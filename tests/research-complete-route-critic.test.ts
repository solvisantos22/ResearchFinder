import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  worker: null as { id: string; userId: string; lane: string } | null
}));
vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));
vi.mock("@/lib/auth/worker-token", () => ({
  findAllowedWorkerByToken: async () => mocked.worker
}));
afterEach(() => {
  mocked.prisma = null;
  mocked.worker = null;
});

async function seedRunningCriticJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: `critic-${Math.random()}@example.com` } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w", tokenHash: "h", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: `2504.${Math.floor(Math.random() * 100000)}`, title: "Src", abstract: "A",
      url: "https://arxiv.org/abs/2504.00001", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id, paperId: paper.id, inboxDate: "2026-06-27", title: "T", summary: "S",
      expandedExplanation: "E", trajectory: "Tr", recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8, feasibilityScore: 0.8,
      overallScore: 0.8, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  const job = await client.researchStageJob.create({
    data: {
      researchProjectId: project.id, userId: user.id, stageType: "plan", kind: "critic",
      status: "running", claimedByWorkerId: worker.id, inputJson: "{}"
    }
  });
  return { user, worker, project, job };
}

describe("complete route accepts research critic job types", () => {
  it("marks a critic job failed when the worker reports an error", async () => {
    const { POST } = await import("@/app/api/workers/jobs/[jobId]/complete/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker, job } = await seedRunningCriticJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      const response = await POST(
        new Request(`http://localhost/api/workers/jobs/${job.id}/complete`, {
          method: "POST",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify({ type: "research_plan_critic", error: "codex crashed" })
        }),
        { params: Promise.resolve({ jobId: job.id }) }
      );
      expect(response.status).toBe(200);
      const updated = await client.researchStageJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(updated.status).toBe("failed");
    });
  });
});
