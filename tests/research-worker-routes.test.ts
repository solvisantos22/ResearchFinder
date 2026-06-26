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

async function seedProjectWithClaimableJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "worker-routes@example.com" } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w", tokenHash: "h", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: "2502.00002",
      title: "Src",
      abstract: "A",
      url: "https://arxiv.org/abs/2502.00002",
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
      title: "T",
      summary: "S",
      expandedExplanation: "E",
      trajectory: "Tr",
      recommended: true,
      noveltyStatus: "not_checked",
      relevanceScore: 0.8,
      significanceScore: 0.8,
      originalityScore: 0.8,
      feasibilityScore: 0.8,
      overallScore: 0.8,
      scoreExplanationsJson: "{}",
      risksJson: "[]",
      smallestSprint: "SS",
      generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: {
      userId: user.id,
      generatedIdeaId: idea.id,
      status: "running",
      currentStage: "plan"
    }
  });
  await client.researchStageJob.create({
    data: {
      researchProjectId: project.id,
      userId: user.id,
      stageType: "plan",
      status: "queued",
      inputJson: JSON.stringify({ researchProjectId: project.id })
    }
  });
  return { user, worker, paper, project };
}

async function seedProjectWithLiteratureJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "worker-routes-lit@example.com" } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w-lit", tokenHash: "h-lit", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: "2502.00003",
      title: "Lit Src",
      abstract: "B",
      url: "https://arxiv.org/abs/2502.00003",
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
      title: "Lit Idea",
      summary: "S",
      expandedExplanation: "E",
      trajectory: "Tr",
      recommended: true,
      noveltyStatus: "not_checked",
      relevanceScore: 0.8,
      significanceScore: 0.8,
      originalityScore: 0.8,
      feasibilityScore: 0.8,
      overallScore: 0.8,
      scoreExplanationsJson: "{}",
      risksJson: "[]",
      smallestSprint: "SS",
      generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: {
      userId: user.id,
      generatedIdeaId: idea.id,
      status: "running",
      currentStage: "literature"
    }
  });
  // Seed a completed plan artifact (ResearchPlanSchema shape)
  const planArtifact = {
    researchProjectId: project.id,
    relationToSourcePaper: "Builds on source paper",
    hypotheses: ["Hypothesis A", "Hypothesis B"],
    experimentalDesign: "Run experiments",
    protocolSteps: ["Step 1", "Step 2"],
    datasets: [],
    baselines: [],
    metrics: ["Accuracy"],
    successCriteria: ["Beats baseline"],
    computeEstimate: "1 GPU day",
    risks: [],
    citations: [
      {
        sourceType: "paper",
        title: "Source Paper",
        url: "https://arxiv.org/abs/2502.00003",
        sourceId: "2502.00003",
        claim: "Foundational work",
        confidence: 0.9
      }
    ]
  };
  await client.researchStageArtifact.create({
    data: {
      researchProjectId: project.id,
      stageType: "plan",
      artifactJson: JSON.stringify(planArtifact)
    }
  });
  await client.researchStageJob.create({
    data: {
      researchProjectId: project.id,
      userId: user.id,
      stageType: "literature",
      status: "queued",
      inputJson: JSON.stringify({ researchProjectId: project.id })
    }
  });
  return { user, worker, paper, project };
}

describe("research_plan worker routes", () => {
  it("claims a research_plan job and returns a valid input", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithClaimableJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      const response = await POST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST",
          headers: { authorization: "Bearer t" }
        })
      );
      const payload = (await response.json()) as {
        job: { type: string; input: { researchProjectId: string; paper: { arxivId: string } } };
      };
      expect(payload.job.type).toBe("research_plan");
      expect(payload.job.input.paper.arxivId).toBe("2502.00002");
      expect(typeof payload.job.input.researchProjectId).toBe("string");
    });
  });
});

describe("research_literature worker routes", () => {
  it("claims a research_literature job and returns a valid input with plan", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithLiteratureJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      const response = await POST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST",
          headers: { authorization: "Bearer t" }
        })
      );
      const rawBody = await response.json();
      const payload = rawBody as {
        job: {
          type: string;
          input: {
            researchProjectId: string;
            paper: { arxivId: string };
            plan: { hypotheses: string[] };
          };
        };
      };
      expect(payload.job.type).toBe("research_literature");
      expect(payload.job.input.paper.arxivId).toBe("2502.00003");
      expect(typeof payload.job.input.researchProjectId).toBe("string");
      expect(Array.isArray(payload.job.input.plan.hypotheses)).toBe(true);
      expect(payload.job.input.plan.hypotheses.length).toBeGreaterThan(0);
    });
  });
});
