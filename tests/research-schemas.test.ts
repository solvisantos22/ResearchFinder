import { describe, expect, it } from "vitest";

import { LiteratureReviewSchema, ResearchPlanJobInputSchema, ResearchPlanSchema } from "@/lib/v2/schemas";

const sourcePaperCitation = {
  sourceType: "paper" as const,
  url: "https://arxiv.org/abs/2501.00001",
  sourceId: "2501.00001",
  title: "Source paper",
  claim: "The original method this work extends.",
  confidence: 0.9
};

const validPlan = {
  researchProjectId: "proj-1",
  relationToSourcePaper: "Extends the source method with X.",
  hypotheses: ["H1: X improves Y."],
  experimentalDesign: "Ablation across three settings.",
  protocolSteps: ["Step 1: build baseline.", "Step 2: run ablation."],
  datasets: ["CIFAR-10"],
  baselines: ["ResNet-18"],
  metrics: ["accuracy"],
  successCriteria: ["Beats baseline by >1%."],
  computeEstimate: "1 GPU-day",
  risks: ["Dataset shift."],
  citations: [sourcePaperCitation]
};

describe("ResearchPlanSchema", () => {
  it("accepts a complete, grounded plan", () => {
    expect(ResearchPlanSchema.parse(validPlan)).toMatchObject({ researchProjectId: "proj-1" });
  });

  it("rejects a missing relationToSourcePaper", () => {
    const { relationToSourcePaper: _omit, ...rest } = validPlan;
    expect(ResearchPlanSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects empty hypotheses, protocolSteps, successCriteria, or citations", () => {
    expect(ResearchPlanSchema.safeParse({ ...validPlan, hypotheses: [] }).success).toBe(false);
    expect(ResearchPlanSchema.safeParse({ ...validPlan, protocolSteps: [] }).success).toBe(false);
    expect(ResearchPlanSchema.safeParse({ ...validPlan, successCriteria: [] }).success).toBe(false);
    expect(ResearchPlanSchema.safeParse({ ...validPlan, citations: [] }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(ResearchPlanSchema.safeParse({ ...validPlan, extra: 1 }).success).toBe(false);
  });

  it("coerces object-valued content fields to strings (model formatting variance)", () => {
    const withObjects = {
      ...validPlan,
      hypotheses: [{ statement: "X improves Y.", rationale: "because Z" }],
      metrics: [{ name: "accuracy", definition: "top-1" }],
      experimentalDesign: { design: "ablation", arms: 3 }
    };
    const parsed = ResearchPlanSchema.parse(withObjects);
    expect(typeof parsed.experimentalDesign).toBe("string");
    expect(parsed.hypotheses.every((h) => typeof h === "string")).toBe(true);
    expect(parsed.metrics.every((m) => typeof m === "string")).toBe(true);
    expect(parsed.hypotheses[0]).toContain("X improves Y.");
    // empty arrays still fail min(1) after coercion
    expect(ResearchPlanSchema.safeParse({ ...withObjects, hypotheses: [] }).success).toBe(false);
  });
});

const validJobInput = {
  jobId: "job-1",
  userId: "user-1",
  researchProjectId: "proj-1",
  idea: {
    id: "idea-1",
    title: "Idea title",
    summary: "Idea summary",
    expandedExplanation: "Expanded explanation",
    trajectory: "Trajectory",
    smallestSprint: "Smallest sprint"
  },
  paper: {
    id: "paper-1",
    arxivId: "2501.00001",
    title: "Source paper",
    abstract: "Abstract",
    url: "https://arxiv.org/abs/2501.00001",
    authors: ["Ada Lovelace"],
    categories: ["cs.LG"],
    publishedAt: "2026-06-25T00:00:00.000Z"
  },
  viability: null,
  citations: [sourcePaperCitation]
};

describe("ResearchPlanJobInputSchema", () => {
  it("accepts a valid job input with null viability", () => {
    expect(ResearchPlanJobInputSchema.parse(validJobInput)).toMatchObject({ jobId: "job-1" });
  });

  it("rejects a paper.publishedAt that is not an ISO datetime", () => {
    const bad = { ...validJobInput, paper: { ...validJobInput.paper, publishedAt: "not-a-timestamp" } };
    expect(ResearchPlanJobInputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(ResearchPlanJobInputSchema.safeParse({ ...validJobInput, extra: 1 }).success).toBe(false);
  });

  it("accepts an optional feedback string from a prior critic", () => {
    expect(ResearchPlanJobInputSchema.parse({ ...validJobInput, feedback: "Add seeds + ablations." }))
      .toMatchObject({ feedback: "Add seeds + ablations." });
    // still valid without feedback
    expect(ResearchPlanJobInputSchema.parse(validJobInput).feedback).toBeUndefined();
  });
});

describe("LiteratureReviewSchema", () => {
  const valid = {
    researchProjectId: "proj-1",
    relationToSourcePaper: "Extends the source paper's method to a new domain.",
    relatedWorks: [
      { title: "Related A", summary: "Does X.", relationToProposed: "We differ by Y." }
    ],
    themes: ["benchmarking"],
    gaps: ["no open benchmark for Z"],
    positioning: "We close the Z gap the surveyed work leaves open.",
    citations: [
      {
        sourceType: "paper",
        title: "Source paper",
        url: "https://arxiv.org/abs/2501.00001",
        sourceId: "2501.00001",
        claim: "Foundational method.",
        confidence: 0.9
      }
    ]
  };

  it("accepts a well-formed literature review", () => {
    expect(LiteratureReviewSchema.parse(valid)).toMatchObject({ researchProjectId: "proj-1" });
  });

  it("rejects a missing relationToSourcePaper", () => {
    const { relationToSourcePaper: _omit, ...rest } = valid;
    expect(LiteratureReviewSchema.safeParse(rest).success).toBe(false);
  });

  it("requires at least one related work, theme, gap, and citation", () => {
    expect(LiteratureReviewSchema.safeParse({ ...valid, relatedWorks: [] }).success).toBe(false);
    expect(LiteratureReviewSchema.safeParse({ ...valid, themes: [] }).success).toBe(false);
    expect(LiteratureReviewSchema.safeParse({ ...valid, gaps: [] }).success).toBe(false);
    expect(LiteratureReviewSchema.safeParse({ ...valid, citations: [] }).success).toBe(false);
  });
});
