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

describe("research plan lifecycle", () => {
  it("developIdea creates a running project + queued plan job, and is idempotent", async () => {
    const { developIdea } = await import("@/lib/jobs/research");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, idea } = await seedIdea(client);

      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      expect(project.status).toBe("running");
      expect(project.currentStage).toBe("plan");

      const job = await client.researchPlanJob.findUniqueOrThrow({
        where: { researchProjectId: project.id }
      });
      expect(job.status).toBe("queued");

      const again = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      expect(again.id).toBe(project.id);
      expect(await client.researchProject.count()).toBe(1);
    });
  });

  it("completing the plan job persists the plan and advances to plan_ready", async () => {
    const { developIdea, claimNextResearchPlanJob, completeResearchPlanJob } = await import(
      "@/lib/jobs/research"
    );
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, paper, idea } = await seedIdea(client);
      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });

      const claimed = await claimNextResearchPlanJob({ userId: user.id, workerId: "w1" });
      expect(claimed?.researchProjectId).toBe(project.id);

      await completeResearchPlanJob({
        jobId: claimed!.id,
        workerId: "w1",
        output: planOutput(project.id, paper)
      });

      const refreshed = await client.researchProject.findUniqueOrThrow({ where: { id: project.id } });
      expect(refreshed.status).toBe("plan_ready");
      const plan = await client.researchPlan.findUniqueOrThrow({
        where: { researchProjectId: project.id }
      });
      expect(JSON.parse(plan.planJson).relationToSourcePaper).toContain("Extends");
    });
  });

  it("rejects completion when the plan omits the source-paper citation", async () => {
    const { developIdea, claimNextResearchPlanJob, completeResearchPlanJob } = await import(
      "@/lib/jobs/research"
    );
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, paper, idea } = await seedIdea(client);
      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const claimed = await claimNextResearchPlanJob({ userId: user.id, workerId: "w1" });

      const bad = planOutput(project.id, paper);
      bad.citations = [
        {
          sourceType: "web" as unknown as "paper",
          url: "https://example.com",
          sourceId: "x",
          title: "Unrelated",
          claim: "Unrelated.",
          confidence: 0.5
        }
      ];

      await expect(
        completeResearchPlanJob({ jobId: claimed!.id, workerId: "w1", output: bad })
      ).rejects.toThrow();
      expect(await client.researchPlan.count()).toBe(0);
    });
  });

  it("does not advance an aborted project on completion", async () => {
    const { developIdea, claimNextResearchPlanJob, completeResearchPlanJob, abortResearchProject } =
      await import("@/lib/jobs/research");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, paper, idea } = await seedIdea(client);
      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const claimed = await claimNextResearchPlanJob({ userId: user.id, workerId: "w1" });

      await abortResearchProject({ currentUserId: user.id, researchProjectId: project.id });
      await completeResearchPlanJob({
        jobId: claimed!.id,
        workerId: "w1",
        output: planOutput(project.id, paper)
      });

      const refreshed = await client.researchProject.findUniqueOrThrow({ where: { id: project.id } });
      expect(refreshed.status).toBe("aborted");
      expect(await client.researchPlan.count()).toBe(0);
    });
  });
});
