import { describe, expect, it } from "vitest";

import { parseInboxGenerationOutput, parseViabilityOutput } from "@/worker/output-validation";

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
});
