import { describe, expect, it } from "vitest";

import { MAX_DAILY_IDEAS } from "@/lib/v2/domain";
import {
  parseInboxGenerationOutput,
  parseNoveltyScanOutput,
  parseResearchStageOutput,
  parseViabilityOutput
} from "@/worker/output-validation";

function createCitation(overrides: Record<string, unknown> = {}) {
  return {
    sourceType: "paper",
    title: "Paper title",
    url: "https://arxiv.org/abs/2606.00001",
    sourceId: "2606.00001",
    claim: "The idea is grounded in the source paper.",
    confidence: 0.95,
    ...overrides
  };
}

function createInboxOutput(overrides: Record<string, unknown> = {}) {
  return {
    inboxDate: "2026-06-23",
    generatedForUserId: "user-1",
    papers: [
      {
        source: "arxiv",
        sourceId: "2606.00001",
        title: "Paper title",
        abstract: "Paper abstract",
        url: "https://arxiv.org/abs/2606.00001",
        authors: ["A. Researcher"],
        categories: ["cs.AI"],
        publishedAt: "2026-06-23T00:00:00.000Z",
        whyPaperMatters: "This paper creates a concrete opening for agent evaluation work.",
        ideas: [
          {
            title: "Build a stress-test benchmark",
            summary: "A concise version of the idea.",
            expandedExplanation: "A longer explanation of the project direction.",
            trajectory: "If viable, this becomes a benchmark paper with reproducible tasks.",
            recommended: true,
            noveltyStatus: "needs_novelty_check",
            scores: {
              relevance: 0.9,
              significance: 0.86,
              originality: 0.78,
              feasibility: 0.82,
              overall: 0.84
            },
            scoreExplanations: {
              relevance: "Directly aligned with the user's profile.",
              significance: "Could produce a meaningful benchmark contribution.",
              originality: "Adjacent work exists, but this framing was not verified as saturated.",
              feasibility: "A small benchmark slice can be created quickly.",
              overall: "Strong enough to show in the inbox."
            },
            risks: ["Related work may already cover the exact stress test."],
            smallestViabilitySprint: "Search related work and create 20 pilot examples.",
            citations: [createCitation()]
          }
        ]
      }
    ],
    ...overrides
  };
}

function createPaperGroup(index: number, ideaCount: number, overall: number) {
  const sourceId = `2606.1${String(index).padStart(4, "0")}`;
  const url = `https://arxiv.org/abs/${sourceId}`;
  return {
    source: "arxiv",
    sourceId,
    title: `Paper ${index}`,
    abstract: `Abstract for paper ${index}.`,
    url,
    authors: ["A. Researcher"],
    categories: ["cs.AI"],
    publishedAt: "2026-06-23T00:00:00.000Z",
    whyPaperMatters: "This paper opens a concrete research direction.",
    ideas: Array.from({ length: ideaCount }, (_, i) => ({
      title: `Idea ${index}-${i}`,
      summary: "A concise version of the idea.",
      expandedExplanation: "A longer explanation of the project direction.",
      trajectory: "If viable, this becomes a paper.",
      recommended: true,
      noveltyStatus: "needs_novelty_check",
      scores: { relevance: 0.8, significance: 0.8, originality: 0.8, feasibility: 0.8, overall },
      scoreExplanations: {
        relevance: "Aligned.",
        significance: "Meaningful.",
        originality: "Distinct.",
        feasibility: "Doable.",
        overall: "Strong enough."
      },
      risks: ["A concrete risk."],
      smallestViabilitySprint: "Run a small pilot.",
      citations: [createCitation({ sourceId, url, title: `Paper ${index}` })]
    }))
  };
}

function createViabilityOutput(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    verdict: "needs_novelty_check",
    summary: "Promising but related work is unresolved.",
    feasibility: "A small pilot can be run.",
    noveltyRisk: "Adjacent work exists.",
    minimumExperiment: "Create 20 examples and compare two baselines.",
    blockers: ["Need focused related-work search."],
    citations: [createCitation({ title: "Source", claim: "Grounded in source." })],
    ...overrides
  };
}

describe("worker output validation", () => {
  it("parses generated inbox json through the v2 schema", () => {
    const parsed = parseInboxGenerationOutput(JSON.stringify(createInboxOutput()));

    expect(parsed.papers[0].ideas[0].title).toBe("Build a stress-test benchmark");
  });

  it("parses viability json through the v2 schema", () => {
    const parsed = parseViabilityOutput(JSON.stringify(createViabilityOutput()));

    expect(parsed.verdict).toBe("needs_novelty_check");
  });

  it("clamps an over-cap inbox to the daily maximum before validating", () => {
    // 4 papers x 3 ideas = 12 > MAX_DAILY_IDEAS (10). Paper 4 is the weakest, so
    // without the clamp the strict schema would reject the whole inbox.
    const papers = [
      createPaperGroup(1, 3, 0.95),
      createPaperGroup(2, 3, 0.9),
      createPaperGroup(3, 3, 0.85),
      createPaperGroup(4, 3, 0.1)
    ];

    const parsed = parseInboxGenerationOutput(JSON.stringify(createInboxOutput({ papers })));

    const total = parsed.papers.reduce((sum, paper) => sum + paper.ideas.length, 0);
    expect(total).toBe(MAX_DAILY_IDEAS);
  });

  it("clamps a paper that exceeds the per-paper cap even within the daily total", () => {
    // One paper with 5 ideas (total 5 <= 10, but > 3 per paper) would otherwise be
    // rejected by ideas.max(MAX_IDEAS_PER_PAPER).
    const parsed = parseInboxGenerationOutput(
      JSON.stringify(createInboxOutput({ papers: [createPaperGroup(1, 5, 0.8)] }))
    );

    expect(parsed.papers).toHaveLength(1);
    expect(parsed.papers[0].ideas.length).toBeLessThanOrEqual(3);
  });

  it("rejects invalid json before schema validation", () => {
    expect(() => parseInboxGenerationOutput("{")).toThrow(SyntaxError);
  });

  it("rejects json that does not match the inbox schema", () => {
    expect(() =>
      parseInboxGenerationOutput(
        JSON.stringify(
          createInboxOutput({
            papers: []
          })
        )
      )
    ).toThrow();
  });

  it("coerces unknown research-stage citation sourceTypes instead of rejecting the stage", () => {
    // Codex labeled citations 2 and 3 with types outside the 4-value union. The
    // strict schema would 400 the whole plan; the worker must coerce them.
    const plan = {
      researchProjectId: "proj-1",
      relationToSourcePaper: "Extends the source paper's method to a new regime.",
      hypotheses: ["The method improves accuracy."],
      experimentalDesign: "Controlled comparison across seeds and baselines.",
      protocolSteps: ["Obtain the dataset.", "Train baselines.", "Run ablations."],
      datasets: ["CIFAR-10"],
      baselines: ["ResNet-18"],
      metrics: ["accuracy"],
      successCriteria: ["Beats the baseline by >=2 points (p<0.05)."],
      computeEstimate: "A few GPU-hours.",
      risks: ["Dataset access may be rate-limited."],
      citations: [
        createCitation(),
        createCitation({ sourceType: "dataset", title: "CIFAR-10 dataset" }),
        createCitation({ sourceType: "preprint", title: "A related preprint" })
      ]
    };

    const parsed = parseResearchStageOutput("plan", JSON.stringify(plan));

    expect(parsed.citations[0].sourceType).toBe("paper");
    expect(parsed.citations[1].sourceType).toBe("generated_analysis");
    expect(parsed.citations[2].sourceType).toBe("generated_analysis");
  });

  it("parses novelty scan output", () => {
    const output = parseNoveltyScanOutput(
      JSON.stringify({
        jobId: "novelty-job-1",
        generatedForUserId: "user-1",
        inboxDate: "2026-06-25",
        scans: [
          {
            generatedIdeaId: "idea-1",
            status: "completed",
            label: "likely_novel",
            confidence: 0.72,
            summary: "No close duplicates were found.",
            overlapExplanation: "Related systems exist, but none target this evaluation gap.",
            queries: ["query"],
            adaptersAttempted: ["arxiv"],
            adaptersFailed: [],
            evidence: [
              {
                sourceType: "arxiv",
                title: "Adjacent source",
                url: "https://arxiv.org/abs/2606.00002",
                sourceId: "2606.00002",
                claim: "Adjacent work exists.",
                overlapLevel: "adjacent",
                confidence: 0.6
              }
            ]
          }
        ]
      })
    );

    expect(output.scans[0].label).toBe("likely_novel");
  });
});
