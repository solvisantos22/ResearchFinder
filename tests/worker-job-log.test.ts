import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));
const mockedWorker = vi.hoisted(() => ({ worker: null as { id: string; userId: string; lane: string } | null }));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

vi.mock("@/lib/auth/worker-token", () => ({
  findAllowedWorkerByToken: async () => mockedWorker.worker
}));

afterEach(() => {
  mocked.prisma = null;
  mockedWorker.worker = null;
});

async function seedWorker(client: PrismaClient, userId: string, workerId: string) {
  return client.workerRegistration.create({
    data: { id: workerId, userId, label: "w", tokenHash: `hash-${workerId}`, status: "active", lane: "research", lastSeenAt: new Date() }
  });
}

async function seedResearchPlanRow(client: PrismaClient, userId: string) {
  const paper = await client.paper.create({
    data: {
      arxivId: "2505.00005", title: "Src", abstract: "A",
      url: "https://arxiv.org/abs/2505.00005", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId, paperId: paper.id, inboxDate: "2026-06-26",
      title: "Stuck idea", summary: "S", expandedExplanation: "E", trajectory: "Tr",
      recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8,
      feasibilityScore: 0.8, overallScore: 0.8, scoreExplanationsJson: "{}",
      risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  return client.researchPlanJob.create({
    data: {
      researchProjectId: project.id, userId, status: "running",
      claimedByWorkerId: "w1", startedAt: new Date(),
      inputJson: JSON.stringify({ researchProjectId: project.id })
    }
  });
}

describe("recordWorkerJobLog", () => {
  it("writes a completed log row with the target label in the message", async () => {
    const { recordWorkerJobLog } = await import("@/lib/workers/job-log");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "log@example.com" } });
      const worker = await seedWorker(client, user.id, "w1");
      const job = await seedResearchPlanRow(client, user.id);

      await recordWorkerJobLog({
        workerId: worker.id, jobType: "research_plan", jobId: job.id, level: "completed"
      });

      const logs = await client.workerJobLog.findMany({ where: { workerId: worker.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("completed");
      expect(logs[0].message).toContain("Stuck idea");
    });
  });

  it("is best-effort: a missing job does not throw and still records a row", async () => {
    const { recordWorkerJobLog } = await import("@/lib/workers/job-log");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "besteff@example.com" } });
      const worker = await seedWorker(client, user.id, "w1");
      await expect(
        recordWorkerJobLog({
          workerId: worker.id, jobType: "research_plan", jobId: "does-not-exist", level: "failed", errorMessage: "boom"
        })
      ).resolves.toBeUndefined();
      const logs = await client.workerJobLog.findMany({ where: { workerId: worker.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("failed");
      expect(logs[0].message).toContain("boom");
    });
  });

  it("the completion route records a failed log when the worker reports an error", async () => {
    const { POST } = await import("@/app/api/workers/jobs/[jobId]/complete/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "route-fail@example.com" } });
      const worker = await client.workerRegistration.create({
        data: { userId: user.id, label: "w", tokenHash: "h", status: "active", lane: "research", lastSeenAt: new Date() }
      });
      const job = await seedResearchPlanRow(client, user.id);
      await client.researchPlanJob.update({ where: { id: job.id }, data: { claimedByWorkerId: worker.id } });
      mockedWorker.worker = { id: worker.id, userId: user.id, lane: "research" };

      const response = await POST(
        new Request(`http://localhost/api/workers/jobs/${job.id}/complete`, {
          method: "POST",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify({ type: "research_plan", error: "codex crashed" })
        }),
        { params: Promise.resolve({ jobId: job.id }) }
      );
      expect(response.status).toBe(200);

      const failed = await client.researchPlanJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(failed.status).toBe("failed");
      const logs = await client.workerJobLog.findMany({ where: { workerId: worker.id } });
      expect(logs.some((l) => l.level === "failed" && l.message.includes("codex crashed"))).toBe(true);
    });
  });
});
