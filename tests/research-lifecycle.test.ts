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

import { developIdea, claimNextResearchStageJob, completeResearchStageJob, failResearchStageJob } from "@/lib/jobs/research";

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

function planOutput(researchProjectId: string, paper: { arxivId: string; url: string }) {
  return {
    researchProjectId,
    relationToSourcePaper: "Extends the source paper method.",
    hypotheses: ["H1."],
    experimentalDesign: "Design.",
    protocolSteps: ["Step 1."],
    datasets: ["D"],
    baselines: ["B"],
    metrics: ["accuracy"],
    successCriteria: ["Beats baseline."],
    computeEstimate: "1 GPU-day",
    risks: ["Risk."],
    citations: [
      {
        sourceType: "paper" as const,
        url: paper.url,
        sourceId: paper.arxivId,
        title: "Source paper",
        claim: "Original method.",
        confidence: 0.9
      }
    ]
  };
}

function literatureOutput(researchProjectId: string, paper: { arxivId: string; url: string }) {
  return {
    researchProjectId,
    relationToSourcePaper: "Extends the source paper.",
    relatedWorks: [{ title: "RW", summary: "does x", relationToProposed: "we differ" }],
    themes: ["theme"],
    gaps: ["gap"],
    positioning: "we close the gap",
    citations: [
      { sourceType: "paper", title: "Source paper", url: paper.url, sourceId: paper.arxivId, claim: "c", confidence: 0.9 }
    ]
  };
}

describe("developIdea (generic stage model)", () => {
  it("creates a project and a queued plan stage job", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea } = await seedIdea(db);
      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const jobs = await db.researchStageJob.findMany({ where: { researchProjectId: project.id } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ stageType: "plan", status: "queued" });
      expect(project.currentStage).toBe("plan");
    });
  });

  it("is idempotent for a non-aborted project", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea } = await seedIdea(db);
      const a = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const b = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      expect(b.id).toBe(a.id);
    });
  });
});

describe("claimNextResearchStageJob", () => {
  it("claims the queued plan job with the idea + paper loaded", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const claimed = await claimNextResearchStageJob({ userId: user.id, workerId: "w1" });
      expect(claimed?.stageType).toBe("plan");
      expect(claimed?.researchProject.generatedIdea.paper.arxivId).toBe("2501.00001");
    });
  });
});

describe("claimNextResearchStageJob heartbeat staleness", () => {
  async function seedRunningExperimentJob(
    client: PrismaClient,
    times: { startedAt: Date; heartbeatAt: Date | null }
  ) {
    const { user, idea } = await seedIdea(client);
    const project = await client.researchProject.create({
      data: {
        userId: user.id,
        generatedIdeaId: idea.id,
        status: "running",
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
        inputJson: JSON.stringify({ researchProjectId: project.id }),
        startedAt: times.startedAt,
        heartbeatAt: times.heartbeatAt
      }
    });
    return { user, project, job };
  }

  const fortyMinutesAgo = () => new Date(Date.now() - 40 * 60 * 1000);

  it("does not reclaim a running job with a fresh heartbeat even if startedAt is old", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user } = await seedRunningExperimentJob(db, {
        startedAt: fortyMinutesAgo(),
        heartbeatAt: new Date()
      });
      const claimed = await claimNextResearchStageJob({ userId: user.id, workerId: "worker-B" });
      expect(claimed).toBeNull();
    });
  });

  it("reclaims a running job whose heartbeat is stale", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user } = await seedRunningExperimentJob(db, {
        startedAt: fortyMinutesAgo(),
        heartbeatAt: fortyMinutesAgo()
      });
      const claimed = await claimNextResearchStageJob({ userId: user.id, workerId: "worker-B" });
      expect(claimed?.claimedByWorkerId).toBe("worker-B");
    });
  });

  it("falls back to startedAt when heartbeatAt is null", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user } = await seedRunningExperimentJob(db, {
        startedAt: fortyMinutesAgo(),
        heartbeatAt: null
      });
      const claimed = await claimNextResearchStageJob({ userId: user.id, workerId: "worker-B" });
      expect(claimed?.claimedByWorkerId).toBe("worker-B");
    });
  });
});

describe("completeResearchStageJob advance", () => {
  it("plan completion enqueues a literature job and sets the project running", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      await completeResearchStageJob({
        jobId: plan!.id, workerId: "w",
        output: planOutput(plan!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: plan!.researchProjectId } });
      expect(project).toMatchObject({ currentStage: "literature", status: "running" });
      const litJob = await db.researchStageJob.findFirst({ where: { researchProjectId: project.id, stageType: "literature" } });
      expect(litJob?.status).toBe("queued");
      const planArtifact = await db.researchStageArtifact.findFirst({ where: { researchProjectId: project.id, stageType: "plan" } });
      expect(planArtifact).not.toBeNull();
    });
  });

  it("literature completion enqueues an experiment job and sets the project running", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      await completeResearchStageJob({
        jobId: plan!.id, workerId: "w",
        output: planOutput(plan!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });
      const lit = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      expect(lit?.stageType).toBe("literature");
      await completeResearchStageJob({
        jobId: lit!.id, workerId: "w",
        output: literatureOutput(lit!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: lit!.researchProjectId } });
      expect(project).toMatchObject({ currentStage: "experiment", status: "running" });
      const experimentJob = await db.researchStageJob.findFirst({ where: { researchProjectId: project.id, stageType: "experiment" } });
      expect(experimentJob?.status).toBe("queued");
    });
  });

  it("rejects a stage output that omits the source-paper citation", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      const bad = planOutput(plan!.researchProjectId, { arxivId: paper.arxivId, url: paper.url });
      bad.citations = bad.citations.map((c) => ({ ...c, sourceType: "generated_analysis" as const, url: "" })) as unknown as typeof bad.citations;
      await expect(
        completeResearchStageJob({ jobId: plan!.id, workerId: "w", output: bad })
      ).rejects.toThrow();
      const artifact = await db.researchStageArtifact.findFirst({ where: { researchProjectId: plan!.researchProjectId } });
      expect(artifact).toBeNull();
    });
  });

  it("abort blocks advancement", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      await db.researchProject.update({ where: { id: plan!.researchProjectId }, data: { status: "aborted" } });
      await completeResearchStageJob({
        jobId: plan!.id, workerId: "w",
        output: planOutput(plan!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: plan!.researchProjectId } });
      expect(project.status).toBe("aborted");
      const litJob = await db.researchStageJob.findFirst({ where: { researchProjectId: project.id, stageType: "literature" } });
      expect(litJob).toBeNull();
    });
  });

  it("failResearchStageJob fails the job and the running project", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      await failResearchStageJob({ jobId: plan!.id, errorMessage: "boom" });
      const job = await db.researchStageJob.findUniqueOrThrow({ where: { id: plan!.id } });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: plan!.researchProjectId } });
      expect(job.status).toBe("failed");
      expect(project.status).toBe("failed");
    });
  });
});
