import { describe, expect, it } from "vitest";

import { AnalysisJobInputSchema, AnalysisResultSchema } from "@/lib/v2/schemas";
import { parseResearchStageOutput } from "@/worker/output-validation";

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
  relationToSourcePaper: "Analyzes the source paper's method results.",
  successCriteriaAssessment: [
    { criterion: "Beat baseline by >2%.", status: "met", evidence: "Accuracy +4% (p<0.05)." }
  ],
  statisticalFindings: [
    { description: "Accuracy delta", method: "paired t-test", value: "p=0.03", interpretation: "Significant." }
  ],
  keyFindings: ["The method significantly beats the baseline on the small split."],
  artifacts: [{ path: "analysis/accuracy.png", caption: "Accuracy vs baseline", kind: "figure", bytes: 20480 }],
  comparisonToBaselines: "Outperforms the vanilla baseline across all seeds.",
  threatsToValidity: ["Single dataset."],
  recommendedNextSteps: ["Repeat on a larger corpus."],
  verdict: "supports_hypotheses",
  summary: "The evidence supports the hypotheses.",
  citations: [
    {
      sourceType: "paper",
      url: "https://arxiv.org/abs/2401.00001",
      sourceId: "2401.00001",
      title: "Source Paper",
      claim: "We analyze results extending this method.",
      confidence: 0.9
    }
  ]
};

describe("AnalysisResultSchema", () => {
  it("accepts a complete, grounded result", () => {
    expect(AnalysisResultSchema.parse(validResult)).toMatchObject({ verdict: "supports_hypotheses" });
  });

  it("rejects an unknown verdict", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, verdict: "great" })).toThrow();
  });

  it("rejects an empty successCriteriaAssessment array", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, successCriteriaAssessment: [] })).toThrow();
  });

  it("rejects an empty keyFindings array", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, keyFindings: [] })).toThrow();
  });

  it("rejects a result with no citations", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, citations: [] })).toThrow();
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, extra: 1 })).toThrow();
  });

  it("is reachable via parseResearchStageOutput", () => {
    expect(parseResearchStageOutput("analysis", JSON.stringify(validResult))).toMatchObject({
      verdict: "supports_hypotheses"
    });
  });
});

describe("AnalysisJobInputSchema", () => {
  const validInput = {
    jobId: "job-1",
    userId: "user-1",
    researchProjectId: "proj-1",
    idea,
    paper,
    plan: {
      relationToSourcePaper: "Extends it.",
      hypotheses: ["H1"],
      successCriteria: ["Beat baseline by >2%."],
      metrics: ["accuracy"],
      baselines: ["vanilla"],
      experimentalDesign: "A/B on a small split."
    },
    literature: {
      positioning: "Novel vs. prior work.",
      gaps: ["No small-scale ablation exists."]
    },
    experiment: {
      hypothesisOutcomes: [{ hypothesis: "H1", outcome: "supported", evidence: "Accuracy rose 4%." }],
      metrics: [{ name: "accuracy", value: "0.84", baseline: "0.80" }],
      findings: ["Beats baseline."],
      limitations: ["One seed."],
      verdict: "success",
      environment: "python 3.11",
      reproductionSteps: ["uv run python train.py"],
      artifacts: [{ path: "experiment/train.py", description: "training script", bytes: 1200 }],
      logsExcerpt: "epoch 1 ... done",
      summary: "Hypothesis supported."
    },
    viability: null,
    citations: []
  };

  it("accepts a valid input with plan, literature and experiment", () => {
    expect(AnalysisJobInputSchema.parse(validInput)).toMatchObject({ jobId: "job-1" });
  });

  it("rejects an empty experiment.hypothesisOutcomes array", () => {
    expect(() =>
      AnalysisJobInputSchema.parse({
        ...validInput,
        experiment: { ...validInput.experiment, hypothesisOutcomes: [] }
      })
    ).toThrow();
  });

  it("requires the experiment block", () => {
    const { experiment: _experiment, ...withoutExperiment } = validInput;
    expect(() => AnalysisJobInputSchema.parse(withoutExperiment)).toThrow();
  });
});
