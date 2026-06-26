import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  getResearchProjectDetail: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: mocked.requireCurrentUser }));
vi.mock("@/lib/jobs/research", () => ({
  getResearchProjectDetail: mocked.getResearchProjectDetail,
  listResearchProjectsForUser: vi.fn()
}));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/app/research/actions", () => ({ abortResearchProjectAction: vi.fn() }));

const PLAN_ARTIFACT_JSON = JSON.stringify({
  researchProjectId: "proj-1",
  relationToSourcePaper: "Extends the source paper.",
  hypotheses: ["H1"],
  experimentalDesign: "D",
  protocolSteps: ["S1"],
  datasets: [],
  baselines: [],
  metrics: ["m"],
  successCriteria: ["win"],
  computeEstimate: "1 GPU-day",
  risks: [],
  citations: [{ sourceType: "paper", url: "https://arxiv.org/abs/2501.00001", title: "Source paper", claim: "c", confidence: 0.9 }]
});

const LIT_ARTIFACT_JSON = JSON.stringify({
  researchProjectId: "proj-1",
  relationToSourcePaper: "Builds directly on the source paper's approach.",
  relatedWorks: [{ title: "Related Work A", summary: "A study on X.", relationToProposed: "Closely related baseline" }],
  themes: ["Theme 1"],
  gaps: ["Gap 1"],
  positioning: "Our work fills gap 1 by extending related work A.",
  citations: [{ sourceType: "paper", url: "https://arxiv.org/abs/2501.00001", title: "Source paper", claim: "c", confidence: 0.9 }]
});

const BASE_PROJECT = {
  id: "proj-1",
  status: "literature_ready",
  currentStage: "literature",
  generatedIdea: { title: "Idea title", paper: { title: "Source paper", url: "https://arxiv.org/abs/2501.00001" } },
  stageJobs: [
    { stageType: "plan", status: "completed", errorMessage: null },
    { stageType: "literature", status: "completed", errorMessage: null }
  ],
  stageArtifacts: [
    { stageType: "plan", artifactJson: PLAN_ARTIFACT_JSON },
    { stageType: "literature", artifactJson: LIT_ARTIFACT_JSON }
  ]
};

beforeEach(() => {
  mocked.requireCurrentUser.mockResolvedValue({ id: "user-1", name: "Researcher" });
});
afterEach(() => vi.clearAllMocks());

describe("research project detail page", () => {
  it("renders the plan artifact section", async () => {
    mocked.getResearchProjectDetail.mockResolvedValue(BASE_PROJECT);
    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    render(await ResearchProjectPage({ params: Promise.resolve({ projectId: "proj-1" }) }));

    expect(screen.getByText("Idea title")).toBeInTheDocument();
    expect(screen.getByText("How this extends the source paper")).toBeInTheDocument();
    expect(screen.getByText("Extends the source paper.")).toBeInTheDocument();
    expect(screen.getByText("H1")).toBeInTheDocument();
    // "Source paper" appears in header link + plan citations
    expect(screen.getAllByText("Source paper").length).toBeGreaterThan(0);
  });

  it("renders the literature artifact section", async () => {
    mocked.getResearchProjectDetail.mockResolvedValue(BASE_PROJECT);
    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    render(await ResearchProjectPage({ params: Promise.resolve({ projectId: "proj-1" }) }));

    expect(screen.getByText("Literature review")).toBeInTheDocument();
    expect(screen.getByText("Our work fills gap 1 by extending related work A.")).toBeInTheDocument();
    expect(screen.getByText("Related Work A")).toBeInTheDocument();
  });

  it("renders an in-progress note for a running project with queued literature job and no artifact", async () => {
    mocked.getResearchProjectDetail.mockResolvedValue({
      id: "proj-1",
      status: "running",
      currentStage: "literature",
      generatedIdea: { title: "Idea title", paper: { title: "Source paper", url: "https://arxiv.org/abs/2501.00001" } },
      stageJobs: [
        { stageType: "plan", status: "completed", errorMessage: null },
        { stageType: "literature", status: "queued", errorMessage: null }
      ],
      stageArtifacts: [
        { stageType: "plan", artifactJson: PLAN_ARTIFACT_JSON }
      ]
    });
    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    render(await ResearchProjectPage({ params: Promise.resolve({ projectId: "proj-1" }) }));

    // Plan is present so no fallback, but literature section should not render
    expect(screen.queryByText("Literature review")).not.toBeInTheDocument();
    // Plan section still renders
    expect(screen.getByText("Extends the source paper.")).toBeInTheDocument();
    // Abort button visible for running project
    expect(screen.getByRole("button", { name: "Abort" })).toBeInTheDocument();
  });

  it("renders fallback when no artifacts exist", async () => {
    mocked.getResearchProjectDetail.mockResolvedValue({
      id: "proj-1",
      status: "running",
      currentStage: "plan",
      generatedIdea: { title: "Idea title", paper: { title: "Source paper", url: "https://arxiv.org/abs/2501.00001" } },
      stageJobs: [
        { stageType: "plan", status: "queued", errorMessage: null }
      ],
      stageArtifacts: []
    });
    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    render(await ResearchProjectPage({ params: Promise.resolve({ projectId: "proj-1" }) }));

    expect(screen.getByText("Work is in progress. Refresh shortly.")).toBeInTheDocument();
  });

  it("calls notFound for a missing/forbidden project", async () => {
    mocked.getResearchProjectDetail.mockResolvedValue(null);
    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    await expect(ResearchProjectPage({ params: Promise.resolve({ projectId: "nope" }) })).rejects.toThrow("notFound");
  });

  it("renders the experiment artifact section", async () => {
    const EXP_ARTIFACT_JSON = JSON.stringify({
      researchProjectId: "proj-1",
      relationToSourcePaper: "Extends the source paper's method.",
      implementationSummary: "Built a small training loop.",
      environment: "python 3.11, torch 2.2",
      hypothesisOutcomes: [
        { hypothesis: "H1", outcome: "supported", evidence: "Accuracy rose 4%." }
      ],
      metrics: [{ name: "accuracy", value: "0.84", baseline: "0.80" }],
      findings: ["The method beats the baseline on the small split."],
      limitations: ["Only one seed."],
      artifacts: [{ path: "train.py", description: "training script", bytes: 1200 }],
      logsExcerpt: "epoch 1 ... done",
      reproductionSteps: ["uv run python train.py"],
      verdict: "success",
      summary: "Hypothesis supported on the minimal experiment.",
      citations: [
        {
          sourceType: "paper",
          url: "https://arxiv.org/abs/2401.00001",
          sourceId: "2401.00001",
          title: "Source Paper",
          claim: "We extend this method.",
          confidence: 0.9
        }
      ]
    });

    mocked.getResearchProjectDetail.mockResolvedValue({
      ...BASE_PROJECT,
      status: "experiment_ready",
      currentStage: "experiment",
      stageJobs: [
        ...BASE_PROJECT.stageJobs,
        { stageType: "experiment", status: "completed", errorMessage: null }
      ],
      stageArtifacts: [
        ...BASE_PROJECT.stageArtifacts,
        { stageType: "experiment", artifactJson: EXP_ARTIFACT_JSON }
      ]
    });

    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    render(await ResearchProjectPage({ params: Promise.resolve({ projectId: "proj-1" }) }));

    expect(screen.getByText("Experiment")).toBeInTheDocument();
    expect(screen.getByText(/Hypothesis outcomes/i)).toBeInTheDocument();
    expect(screen.getAllByText("H1").length).toBeGreaterThan(0);
    expect(screen.getByText("Hypothesis supported on the minimal experiment.")).toBeInTheDocument();
    expect(screen.getByText("Extends the source paper's method.")).toBeInTheDocument();
  });
});
