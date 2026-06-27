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

import { recordResearchStageHeartbeat } from "@/lib/jobs/research";

async function seedIdea(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "researcher@example.com" } });
  const paper = await client.paper.create({
    data: {
      arxivId: "2501.00001",
      title: "Source paper",
      abstract: "Abstract",
      url: "https://arxiv.org/abs/2501.00001",
      publishedAt: new Date(),
      arxivUpdatedAt: new Date(),
      authorsJson: "[]",
      categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id,
      paperId: paper.id,
      inboxDate: "2026-06-25",
      title: "Idea title",
      summary: "Idea summary",
      expandedExplanation: "Expanded explanation",
      trajectory: "Trajectory",
      recommended: true,
      noveltyStatus: "not_checked",
      relevanceScore: 0.8,
      significanceScore: 0.8,
      originalityScore: 0.8,
      feasibilityScore: 0.8,
      overallScore: 0.8,
      scoreExplanationsJson: "{}",
      risksJson: "[]",
      smallestSprint: "Smallest sprint",
      generatedBy: "codex"
    }
  });
  return { user, paper, idea };
}

async function seedRunningExperimentJob(
  client: PrismaClient,
  projectStatus: "running" | "aborted"
) {
  const { user, idea } = await seedIdea(client);
  const project = await client.researchProject.create({
    data: {
      userId: user.id,
      generatedIdeaId: idea.id,
      status: projectStatus,
      currentStage: "experiment"
    }
  });
  const job = await client.researchStageJob.create({
    data: {
      researchProjectId: project.id,
      userId: user.id,
      stageType: "experiment",
      status: "running",
      claimedByWorkerId: "worker-A",
      heartbeatAt: null,
      inputJson: "{}"
    }
  });
  return { user, project, job };
}

describe("recordResearchStageHeartbeat", () => {
  it("updates heartbeatAt and reports not-aborted for a running job", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { job } = await seedRunningExperimentJob(db, "running");
      const result = await recordResearchStageHeartbeat({ jobId: job.id, workerId: "worker-A" });
      expect(result).toEqual({ aborted: false });
      const updated = await db.researchStageJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(updated.heartbeatAt).not.toBeNull();
    });
  });

  it("reports aborted when the project is aborted", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { job } = await seedRunningExperimentJob(db, "aborted");
      const result = await recordResearchStageHeartbeat({ jobId: job.id, workerId: "worker-A" });
      expect(result).toEqual({ aborted: true });
    });
  });

  it("returns null when the job is not claimed by this worker", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { job } = await seedRunningExperimentJob(db, "running");
      const result = await recordResearchStageHeartbeat({ jobId: job.id, workerId: "worker-OTHER" });
      expect(result).toBeNull();
    });
  });
});
