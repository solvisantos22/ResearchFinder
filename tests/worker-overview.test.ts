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

async function seedRunningResearchPlan(client: PrismaClient, userId: string, workerId: string) {
  const paper = await client.paper.create({
    data: {
      arxivId: "2504.00004", title: "Src", abstract: "A",
      url: "https://arxiv.org/abs/2504.00004", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId, paperId: paper.id, inboxDate: "2026-06-26",
      title: "ProbeCraft", summary: "S", expandedExplanation: "E", trajectory: "Tr",
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
      researchProjectId: project.id, userId, status: "running",
      claimedByWorkerId: workerId, startedAt: new Date(),
      inputJson: JSON.stringify({ researchProjectId: project.id }),
      stageType: "plan"
    }
  });
}

describe("getWorkersOverviewForUser", () => {
  it("reports an online worker with its current job and recent history", async () => {
    const { getWorkersOverviewForUser } = await import("@/lib/workers/overview");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "overview@example.com" } });
      const worker = await client.workerRegistration.create({
        data: {
          userId: user.id, label: "Codex worker", tokenHash: "h",
          status: "active", lane: "research", lastSeenAt: new Date()
        }
      });
      await seedRunningResearchPlan(client, user.id, worker.id);
      await client.workerJobLog.create({
        data: { workerId: worker.id, jobType: "research_plan", jobId: "old", level: "completed", message: "Completed research_plan for \"Prior\"" }
      });

      const overview = await getWorkersOverviewForUser(user.id);
      expect(overview).toHaveLength(1);
      const row = overview[0];
      expect(row.lane).toBe("research");
      expect(row.status).toBe("online");
      expect(row.currentJobs).toHaveLength(1);
      expect(row.currentJobs[0].jobType).toBe("research_plan");
      expect(row.currentJobs[0].targetLabel).toBe("ProbeCraft");
      expect(row.recentLogs).toHaveLength(1);
      expect(row.recentLogs[0].level).toBe("completed");
    });
  });

  it("reports offline when lastSeenAt is stale and excludes revoked workers", async () => {
    const { getWorkersOverviewForUser } = await import("@/lib/workers/overview");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "offline@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id, label: "Stale", tokenHash: "h", status: "active", lane: "both",
          lastSeenAt: new Date(Date.now() - 10 * 60 * 1000)
        }
      });
      await client.workerRegistration.create({
        data: {
          userId: user.id, label: "Gone", tokenHash: "h2", status: "active", lane: "both",
          lastSeenAt: new Date(), revokedAt: new Date()
        }
      });

      const overview = await getWorkersOverviewForUser(user.id);
      expect(overview).toHaveLength(1);
      expect(overview[0].label).toBe("Stale");
      expect(overview[0].status).toBe("offline");
      expect(overview[0].currentJobs).toHaveLength(0);
    });
  });
});
