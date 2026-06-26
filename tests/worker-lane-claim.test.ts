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

async function seedResearchPlanJob(client: PrismaClient, userId: string) {
  const paper = await client.paper.create({
    data: {
      arxivId: "2503.00003",
      title: "Src",
      abstract: "A",
      url: "https://arxiv.org/abs/2503.00003",
      publishedAt: new Date(),
      arxivUpdatedAt: new Date(),
      authorsJson: "[]",
      categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId, paperId: paper.id, inboxDate: "2026-06-26",
      title: "T", summary: "S", expandedExplanation: "E", trajectory: "Tr",
      recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8,
      feasibilityScore: 0.8, overallScore: 0.8, scoreExplanationsJson: "{}",
      risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  await client.researchStageJob.create({
    data: {
      researchProjectId: project.id, userId, status: "queued",
      inputJson: JSON.stringify({ researchProjectId: project.id }),
      stageType: "plan"
    }
  });
}

async function postClaim() {
  const { POST } = await import("@/app/api/workers/claim/route");
  const response = await POST(
    new Request("http://localhost/api/workers/claim", {
      method: "POST",
      headers: { authorization: "Bearer t" }
    })
  );
  return (await response.json()) as { job: { type: string } | null };
}

describe("lane-aware claim", () => {
  it("an inbox-lane worker does NOT claim a queued research_plan job", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "inbox-lane@example.com" } });
      const workerReg = await client.workerRegistration.create({
        data: { userId: user.id, label: "w", tokenHash: "h", status: "active", lane: "inbox" }
      });
      mocked.worker = { id: workerReg.id, userId: user.id, lane: "inbox" };
      await seedResearchPlanJob(client, user.id);

      const payload = await postClaim();
      expect(payload.job).toBeNull();
    });
  });

  it("a research-lane worker claims the queued research_plan job", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "research-lane@example.com" } });
      const workerReg = await client.workerRegistration.create({
        data: { userId: user.id, label: "w", tokenHash: "h", status: "active", lane: "research" }
      });
      mocked.worker = { id: workerReg.id, userId: user.id, lane: "research" };
      await seedResearchPlanJob(client, user.id);

      const payload = await postClaim();
      expect(payload.job?.type).toBe("research_plan");
    });
  });

  it("a both-lane worker claims the queued research_plan job", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "both-lane@example.com" } });
      const workerReg = await client.workerRegistration.create({
        data: { userId: user.id, label: "w", tokenHash: "h", status: "active", lane: "both" }
      });
      mocked.worker = { id: workerReg.id, userId: user.id, lane: "both" };
      await seedResearchPlanJob(client, user.id);

      const payload = await postClaim();
      expect(payload.job?.type).toBe("research_plan");
    });
  });
});
