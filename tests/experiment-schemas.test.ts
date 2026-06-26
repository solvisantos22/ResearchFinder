import { describe, expect, it } from "vitest";

import {
  ExperimentJobInputSchema,
  ExperimentResultSchema
} from "@/lib/v2/schemas";

const paper = {
  id: "paper-1",
  arxivId: "2401.00001",
  title: "Source Paper",
  abstract: "Abstract.",
  url: "https://arxiv.org/abs/2401.00001",
  authors: ["A. Author"],
  categories: ["cs.LG"],
  publishedAt: "2024-01-01T00:00:00.000Z"
};

const idea = {
  id: "idea-1",
  title: "Idea",
  summary: "Summary",
  expandedExplanation: "Explanation",
  trajectory: "Trajectory",
  smallestSprint: "Sprint"
};

const validResult = {
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
};

describe("ExperimentResultSchema", () => {
  it("accepts a complete, grounded result", () => {
    expect(ExperimentResultSchema.parse(validResult)).toMatchObject({ verdict: "success" });
  });

  it("rejects an unknown verdict", () => {
    expect(() => ExperimentResultSchema.parse({ ...validResult, verdict: "great" })).toThrow();
  });

  it("rejects an empty hypothesisOutcomes array", () => {
    expect(() => ExperimentResultSchema.parse({ ...validResult, hypothesisOutcomes: [] })).toThrow();
  });

  it("rejects a result with no citations", () => {
    expect(() => ExperimentResultSchema.parse({ ...validResult, citations: [] })).toThrow();
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(() => ExperimentResultSchema.parse({ ...validResult, extra: 1 })).toThrow();
  });
});

describe("ExperimentJobInputSchema", () => {
  const validInput = {
    jobId: "job-1",
    userId: "user-1",
    researchProjectId: "proj-1",
    idea,
    paper,
    plan: {
      relationToSourcePaper: "Extends it.",
      hypotheses: ["H1"],
      experimentalDesign: "A/B on a small split.",
      protocolSteps: ["Prepare data", "Train", "Evaluate"],
      datasets: ["toy-set"],
      baselines: ["vanilla"],
      metrics: ["accuracy"],
      successCriteria: ["Beat baseline by >2%."]
    },
    literature: {
      positioning: "Novel vs. prior work.",
      gaps: ["No small-scale ablation exists."]
    },
    viability: null,
    citations: []
  };

  it("accepts a valid input with plan + literature", () => {
    expect(ExperimentJobInputSchema.parse(validInput)).toMatchObject({ jobId: "job-1" });
  });

  it("rejects an empty plan.hypotheses array", () => {
    expect(() =>
      ExperimentJobInputSchema.parse({ ...validInput, plan: { ...validInput.plan, hypotheses: [] } })
    ).toThrow();
  });

  it("requires the literature block", () => {
    const { literature: _literature, ...withoutLiterature } = validInput;
    expect(() => ExperimentJobInputSchema.parse(withoutLiterature)).toThrow();
  });
});
