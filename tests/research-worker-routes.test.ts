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

async function seedProjectWithExperimentJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "worker-routes-exp@example.com" } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w-exp", tokenHash: "h-exp", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: "2502.00004",
      title: "Exp Src",
      abstract: "C",
      url: "https://arxiv.org/abs/2502.00004",
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
      title: "Exp Idea",
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
      currentStage: "experiment"
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
        url: "https://arxiv.org/abs/2502.00004",
        sourceId: "2502.00004",
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
  // Seed a completed literature artifact (LiteratureReviewSchema shape)
  const literatureArtifact = {
    researchProjectId: project.id,
    relationToSourcePaper: "Extends the source paper with a literature survey",
    relatedWorks: [
      {
        title: "Related Work A",
        summary: "Explores a similar approach",
        relationToProposed: "Complementary method"
      }
    ],
    themes: ["Machine learning", "Efficiency"],
    gaps: ["Lack of large-scale evaluation"],
    positioning: "This work fills the gap by providing large-scale experiments",
    citations: [
      {
        sourceType: "paper",
        title: "Source Paper",
        url: "https://arxiv.org/abs/2502.00004",
        sourceId: "2502.00004",
        claim: "Foundational source paper",
        confidence: 0.95
      }
    ]
  };
  await client.researchStageArtifact.create({
    data: {
      researchProjectId: project.id,
      stageType: "literature",
      artifactJson: JSON.stringify(literatureArtifact)
    }
  });
  await client.researchStageJob.create({
    data: {
      researchProjectId: project.id,
      userId: user.id,
      stageType: "experiment",
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

describe("research_experiment worker routes", () => {
  it("claims a research_experiment job and returns input with plan and literature", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithExperimentJob(client);
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
            literature: { gaps: string[] };
          };
        };
      };
      expect(payload.job.type).toBe("research_experiment");
      expect(payload.job.input.paper.arxivId).toBe("2502.00004");
      expect(typeof payload.job.input.researchProjectId).toBe("string");
      expect(payload.job.input.plan.hypotheses.length).toBeGreaterThan(0);
      expect(payload.job.input.literature.gaps.length).toBeGreaterThan(0);
    });
  });
});

async function seedProjectWithAnalysisJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "worker-routes-ana@example.com" } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w-ana", tokenHash: "h-ana", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: "2502.00005",
      title: "Ana Src",
      abstract: "D",
      url: "https://arxiv.org/abs/2502.00005",
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
      title: "Ana Idea",
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
      currentStage: "analysis"
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
        url: "https://arxiv.org/abs/2502.00005",
        sourceId: "2502.00005",
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
  // Seed a completed literature artifact (LiteratureReviewSchema shape)
  const literatureArtifact = {
    researchProjectId: project.id,
    relationToSourcePaper: "Extends the source paper with a literature survey",
    relatedWorks: [
      {
        title: "Related Work A",
        summary: "Explores a similar approach",
        relationToProposed: "Complementary method"
      }
    ],
    themes: ["Machine learning", "Efficiency"],
    gaps: ["Lack of large-scale evaluation"],
    positioning: "This work fills the gap by providing large-scale experiments",
    citations: [
      {
        sourceType: "paper",
        title: "Source Paper",
        url: "https://arxiv.org/abs/2502.00005",
        sourceId: "2502.00005",
        claim: "Foundational source paper",
        confidence: 0.95
      }
    ]
  };
  await client.researchStageArtifact.create({
    data: {
      researchProjectId: project.id,
      stageType: "literature",
      artifactJson: JSON.stringify(literatureArtifact)
    }
  });
  // Seed a completed experiment artifact (ExperimentResultSchema shape)
  const experimentArtifact = {
    researchProjectId: project.id,
    relationToSourcePaper: "Implements and tests the source paper's method.",
    implementationSummary: "Built a minimal training loop.",
    environment: "python 3.11",
    hypothesisOutcomes: [{ hypothesis: "Hypothesis A", outcome: "supported", evidence: "Accuracy improved." }],
    metrics: [{ name: "accuracy", value: "0.84", baseline: "0.80" }],
    findings: ["Beats the baseline on the small split."],
    limitations: ["Single seed."],
    artifacts: [{ path: "experiment/train.py", description: "training script", bytes: 1200 }],
    logsExcerpt: "epoch 1 ... done",
    reproductionSteps: ["uv run python train.py"],
    verdict: "success",
    summary: "Hypothesis supported.",
    citations: [
      { sourceType: "paper", title: "Source Paper", url: "https://arxiv.org/abs/2502.00005", sourceId: "2502.00005", claim: "Foundational", confidence: 0.9 }
    ]
  };
  await client.researchStageArtifact.create({
    data: {
      researchProjectId: project.id,
      stageType: "experiment",
      artifactJson: JSON.stringify(experimentArtifact)
    }
  });
  await client.researchStageJob.create({
    data: {
      researchProjectId: project.id,
      userId: user.id,
      stageType: "analysis",
      status: "queued",
      inputJson: JSON.stringify({ researchProjectId: project.id })
    }
  });
  return { user, worker, paper, project };
}

async function seedProjectWithPlanCriticJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "worker-routes-critic@example.com" } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w-critic", tokenHash: "h-critic", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: "2502.00006", title: "Critic Src", abstract: "E",
      url: "https://arxiv.org/abs/2502.00006", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id, paperId: paper.id, inboxDate: "2026-06-25", title: "Critic Idea", summary: "S",
      expandedExplanation: "E", trajectory: "Tr", recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8, feasibilityScore: 0.8,
      overallScore: 0.8, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  const planArtifact = {
    researchProjectId: project.id, relationToSourcePaper: "Builds on source paper",
    hypotheses: ["Hypothesis A"], experimentalDesign: "Run experiments", protocolSteps: ["Step 1"],
    datasets: [], baselines: [], metrics: ["Accuracy"], successCriteria: ["Beats baseline"],
    computeEstimate: "1 GPU day", risks: [],
    citations: [{ sourceType: "paper", title: "Source Paper", url: "https://arxiv.org/abs/2502.00006", sourceId: "2502.00006", claim: "Foundational", confidence: 0.9 }]
  };
  await client.researchStageArtifact.create({
    data: { researchProjectId: project.id, stageType: "plan", artifactJson: JSON.stringify(planArtifact) }
  });
  await client.researchStageJob.create({
    data: { researchProjectId: project.id, userId: user.id, stageType: "plan", kind: "critic", status: "queued", inputJson: JSON.stringify({ researchProjectId: project.id, stageType: "plan" }) }
  });
  return { user, worker, paper, project };
}

describe("research critic worker routes", () => {
  it("claims a plan critic job and returns a critic input with the artifact to judge", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithPlanCriticJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      const response = await POST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST", headers: { authorization: "Bearer t" }
        })
      );
      const payload = (await response.json()) as {
        job: {
          type: string;
          input: {
            researchProjectId: string;
            stageType: string;
            artifactToJudge: { hypotheses: string[] };
            sourcePaper: { arxivId: string };
            criteria: string;
          };
        };
      };
      expect(payload.job.type).toBe("research_plan_critic");
      expect(payload.job.input.stageType).toBe("plan");
      expect(payload.job.input.artifactToJudge.hypotheses.length).toBeGreaterThan(0);
      expect(payload.job.input.sourcePaper.arxivId).toBe("2502.00006");
      expect(payload.job.input.criteria).toContain("Phase 2");
    });
  });
});

describe("research_analysis worker routes", () => {
  it("claims a research_analysis job and returns input with plan, literature and experiment", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithAnalysisJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      const response = await POST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST",
          headers: { authorization: "Bearer t" }
        })
      );
      const payload = (await response.json()) as {
        job: {
          type: string;
          input: {
            researchProjectId: string;
            paper: { arxivId: string };
            plan: { successCriteria: string[] };
            experiment: { findings: string[] };
          };
        };
      };
      expect(payload.job.type).toBe("research_analysis");
      expect(payload.job.input.paper.arxivId).toBe("2502.00005");
      expect(payload.job.input.plan.successCriteria.length).toBeGreaterThan(0);
      expect(payload.job.input.experiment.findings.length).toBeGreaterThan(0);
    });
  });
});

describe("research stage completion routes", () => {
  it("completing a running plan stage job advances project to literature stage", async () => {
    const { POST: claimPOST } = await import("@/app/api/workers/claim/route");
    const { POST: completePOST } = await import(
      "@/app/api/workers/jobs/[jobId]/complete/route"
    );

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker, paper, project } = await seedProjectWithClaimableJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      // Claim the job to get it running
      const claimResponse = await claimPOST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST",
          headers: { authorization: "Bearer t" }
        })
      );
      expect(claimResponse.status).toBe(200);
      const claimPayload = (await claimResponse.json()) as { job: { id: string } };
      const jobId = claimPayload.job.id;

      // Build a valid ResearchPlanSchema output citing the source paper
      const planOutput = {
        researchProjectId: project.id,
        relationToSourcePaper: "Builds directly on source paper findings",
        hypotheses: ["Primary hypothesis A"],
        experimentalDesign: "Controlled experiment with baseline comparison",
        protocolSteps: ["Step 1: Prepare dataset", "Step 2: Run baseline"],
        datasets: [],
        baselines: ["GPT-4"],
        metrics: ["Accuracy"],
        successCriteria: ["Beats baseline by 5%"],
        computeEstimate: "1 GPU day",
        risks: [],
        citations: [
          {
            sourceType: "paper",
            title: "Source Paper",
            url: paper.url,
            sourceId: paper.arxivId,
            claim: "Foundational work on the topic",
            confidence: 0.9
          }
        ]
      };

      const completeResponse = await completePOST(
        new Request(`http://localhost/api/workers/jobs/${jobId}/complete`, {
          method: "POST",
          headers: {
            authorization: "Bearer t",
            "content-type": "application/json"
          },
          body: JSON.stringify({ type: "research_plan", output: planOutput })
        }),
        { params: Promise.resolve({ jobId }) }
      );
      expect(completeResponse.status).toBe(200);

      // Project should advance to literature stage
      const updatedProject = await client.researchProject.findUniqueOrThrow({
        where: { id: project.id }
      });
      expect(updatedProject.currentStage).toBe("literature");
      expect(updatedProject.status).toBe("running");

      // A queued literature job should exist
      const litJob = await client.researchStageJob.findFirst({
        where: { researchProjectId: project.id, stageType: "literature", status: "queued" }
      });
      expect(litJob).not.toBeNull();

      // A plan artifact should exist
      const planArtifact = await client.researchStageArtifact.findFirst({
        where: { researchProjectId: project.id, stageType: "plan" }
      });
      expect(planArtifact).not.toBeNull();
    });
  });

  it("completing a running literature stage job advances the project to experiment", async () => {
    const { POST: claimPOST } = await import("@/app/api/workers/claim/route");
    const { POST: completePOST } = await import(
      "@/app/api/workers/jobs/[jobId]/complete/route"
    );

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker, paper, project } = await seedProjectWithLiteratureJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      // Claim the literature job
      const claimResponse = await claimPOST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST",
          headers: { authorization: "Bearer t" }
        })
      );
      expect(claimResponse.status).toBe(200);
      const claimPayload = (await claimResponse.json()) as { job: { id: string } };
      const jobId = claimPayload.job.id;

      // Build a valid LiteratureReviewSchema output citing the source paper
      const litOutput = {
        researchProjectId: project.id,
        relationToSourcePaper: "Extends the source paper with a literature survey",
        relatedWorks: [
          {
            title: "Related Work A",
            summary: "Explores a similar approach",
            relationToProposed: "Complementary method"
          }
        ],
        themes: ["Machine learning", "Efficiency"],
        gaps: ["Lack of large-scale evaluation"],
        positioning: "This work fills the gap by providing large-scale experiments",
        citations: [
          {
            sourceType: "paper",
            title: "Source Paper",
            url: paper.url,
            sourceId: paper.arxivId,
            claim: "Foundational source paper",
            confidence: 0.95
          }
        ]
      };

      const completeResponse = await completePOST(
        new Request(`http://localhost/api/workers/jobs/${jobId}/complete`, {
          method: "POST",
          headers: {
            authorization: "Bearer t",
            "content-type": "application/json"
          },
          body: JSON.stringify({ type: "research_literature", output: litOutput })
        }),
        { params: Promise.resolve({ jobId }) }
      );
      expect(completeResponse.status).toBe(200);

      // Project should advance to the experiment stage and stay running
      const updatedProject = await client.researchProject.findUniqueOrThrow({
        where: { id: project.id }
      });
      expect(updatedProject).toMatchObject({ currentStage: "experiment", status: "running" });

      // A queued experiment job should exist
      const experimentJob = await client.researchStageJob.findFirst({
        where: { researchProjectId: project.id, stageType: "experiment", status: "queued" }
      });
      expect(experimentJob).not.toBeNull();

      // A literature artifact should exist
      const litArtifact = await client.researchStageArtifact.findFirst({
        where: { researchProjectId: project.id, stageType: "literature" }
      });
      expect(litArtifact).not.toBeNull();
    });
  });

  it("completes a research_analysis job and sets the project analysis_ready", async () => {
    const { POST: completePOST } = await import(
      "@/app/api/workers/jobs/[jobId]/complete/route"
    );
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker, project } = await seedProjectWithAnalysisJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      // Claim it so it is "running" and owned by this worker.
      const { POST: claimPOST } = await import("@/app/api/workers/claim/route");
      const claimResponse = await claimPOST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST",
          headers: { authorization: "Bearer t" }
        })
      );
      const { job } = (await claimResponse.json()) as { job: { id: string } };
      const jobId = job.id;

      const output = {
        researchProjectId: project.id,
        relationToSourcePaper: "Analyzes results extending the source paper.",
        successCriteriaAssessment: [
          { criterion: "Beats baseline", status: "met", evidence: "Accuracy +4%." }
        ],
        statisticalFindings: [
          { description: "Accuracy delta", method: "t-test", value: "p=0.03", interpretation: "Significant." }
        ],
        keyFindings: ["Beats the baseline."],
        artifacts: [{ path: "analysis/accuracy.png", caption: "Accuracy", kind: "figure", bytes: 2048 }],
        comparisonToBaselines: "Outperforms vanilla.",
        threatsToValidity: ["Single dataset."],
        recommendedNextSteps: ["Scale up."],
        verdict: "supports_hypotheses",
        summary: "Hypotheses supported.",
        citations: [
          { sourceType: "paper", title: "Source Paper", url: "https://arxiv.org/abs/2502.00005", sourceId: "2502.00005", claim: "Foundational", confidence: 0.9 }
        ]
      };

      const completeResponse = await completePOST(
        new Request(`http://localhost/api/workers/jobs/${jobId}/complete`, {
          method: "POST",
          headers: { authorization: "Bearer t" },
          body: JSON.stringify({ type: "research_analysis", output })
        }),
        { params: Promise.resolve({ jobId }) }
      );
      expect(completeResponse.status).toBe(200);

      const updated = await client.researchProject.findUniqueOrThrow({ where: { id: project.id } });
      expect(updated.status).toBe("analysis_ready");
      const artifact = await client.researchStageArtifact.findFirst({
        where: { researchProjectId: project.id, stageType: "analysis" }
      });
      expect(artifact).not.toBeNull();
    });
  });
});
