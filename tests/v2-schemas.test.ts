import { describe, expect, it } from "vitest";

import { clampUnitScore } from "@/lib/v2/domain";
import {
  CitationSchema,
  GeneratedInboxSchema,
  InboxGenerationJobInputSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";

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

function createIdea(overrides: Record<string, unknown> = {}) {
  return {
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
    citations: [createCitation()],
    ...overrides
  };
}

function createPaper(overrides: Record<string, unknown> = {}) {
  return {
    source: "arxiv",
    sourceId: "2606.00001",
    title: "Paper title",
    abstract: "Paper abstract",
    url: "https://arxiv.org/abs/2606.00001",
    authors: ["A. Researcher"],
    categories: ["cs.AI"],
    publishedAt: "2026-06-23T00:00:00.000Z",
    whyPaperMatters: "This paper creates a concrete opening for agent evaluation work.",
    ideas: [createIdea()],
    ...overrides
  };
}

function createInbox(overrides: Record<string, unknown> = {}) {
  return {
    inboxDate: "2026-06-23",
    generatedForUserId: "user-1",
    papers: [createPaper()],
    ...overrides
  };
}

function createJobProfile(overrides: Record<string, unknown> = {}) {
  return {
    fieldPreset: "ai_ml",
    keywords: ["agent evaluation"],
    constraints: ["No frontier-scale training"],
    preferredOutputs: ["benchmark"],
    arxivQuery: "cat:cs.AI",
    maxIdeas: 10,
    maxIdeasPerPaper: 3,
    ...overrides
  };
}

function createJobInput(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    userId: "user-1",
    inboxDate: "2026-06-23",
    profile: createJobProfile(),
    candidatePapers: [],
    ...overrides
  };
}

describe("v2 worker schemas", () => {
  it("accepts a generated inbox with 10 or fewer ideas and at most 3 ideas per paper", () => {
    const result = GeneratedInboxSchema.parse(createInbox());

    expect(result.papers[0].ideas[0].noveltyStatus).toBe("needs_novelty_check");
  });

  it("rejects inbox outputs with more than 3 ideas for one paper", () => {
    const paper = createPaper({
      whyPaperMatters: "Reason",
      ideas: Array.from({ length: 4 }, (_, index) =>
        createIdea({
          title: `Idea ${index}`,
          summary: "Summary",
          expandedExplanation: "Expanded explanation",
          trajectory: "Trajectory",
          recommended: index === 0,
          noveltyStatus: "verified",
          scores: {
            relevance: 0.8,
            significance: 0.8,
            originality: 0.8,
            feasibility: 0.8,
            overall: 0.8
          },
          scoreExplanations: {
            relevance: "Relevance",
            significance: "Significance",
            originality: "Originality",
            feasibility: "Feasibility",
            overall: "Overall"
          },
          risks: ["Risk"],
          smallestViabilitySprint: "Sprint",
          citations: [
            createCitation({
              claim: "Claim",
              confidence: 0.9
            })
          ]
        })
      )
    });

    expect(() =>
      GeneratedInboxSchema.parse(
        createInbox({
          papers: [paper]
        })
      )
    ).toThrow();
  });

  it("rejects inbox outputs with more than 10 total ideas", () => {
    const papers = Array.from({ length: 4 }, () =>
      createPaper({
        ideas: Array.from({ length: 3 }, (_, index) =>
          createIdea({
            title: `Idea ${index}`,
            recommended: index === 0
          })
        )
      })
    );

    expect(() =>
      GeneratedInboxSchema.parse(
        createInbox({
          papers
        })
      )
    ).toThrow();
  });

  it("requires each generated idea to cite the source arxiv paper", () => {
    expect(() =>
      GeneratedInboxSchema.parse(
        createInbox({
          papers: [
            createPaper({
              ideas: [
                createIdea({
                  citations: [
                    {
                      sourceType: "generated_analysis",
                      title: "Generated analysis",
                      url: "",
                      claim: "The model reasoned about the source paper.",
                      confidence: 0.5
                    }
                  ]
                })
              ]
            })
          ]
        })
      )
    ).toThrow();
  });

  it("rejects empty urls for paper, related work, and web citations", () => {
    for (const sourceType of ["paper", "related_work", "web"] as const) {
      expect(() =>
        CitationSchema.parse(
          createCitation({
            sourceType,
            url: ""
          })
        )
      ).toThrow();
    }

    const generatedAnalysisCitation = CitationSchema.parse({
      sourceType: "generated_analysis",
      title: "Generated analysis",
      url: "",
      claim: "The model added synthesis beyond retrieved sources.",
      confidence: 0.7
    });

    expect(generatedAnalysisCitation.url).toBe("");
  });

  it("rejects invalid calendar dates for inboxes and job inputs", () => {
    expect(() =>
      GeneratedInboxSchema.parse(
        createInbox({
          inboxDate: "2026-99-99"
        })
      )
    ).toThrow();

    expect(() =>
      InboxGenerationJobInputSchema.parse(
        createJobInput({
          inboxDate: "2026-99-99"
        })
      )
    ).toThrow();
  });

  it("rejects unknown top-level and nested fields from agent JSON", () => {
    expect(() =>
      GeneratedInboxSchema.parse({
        ...createInbox(),
        unexpected: "field"
      })
    ).toThrow();

    expect(() =>
      GeneratedInboxSchema.parse(
        createInbox({
          papers: [
            createPaper({
              ideas: [
                {
                  ...createIdea(),
                  unexpected: "field"
                }
              ]
            })
          ]
        })
      )
    ).toThrow();
  });

  it("rejects scores outside the unit interval", () => {
    expect(() =>
      GeneratedInboxSchema.parse(
        createInbox({
          papers: [
            createPaper({
              ideas: [
                createIdea({
                  scores: {
                    relevance: 0.9,
                    significance: 0.86,
                    originality: 0.78,
                    feasibility: 0.82,
                    overall: 1.1
                  }
                })
              ]
            })
          ]
        })
      )
    ).toThrow();
  });

  it("rejects whitespace-only required text fields", () => {
    expect(() =>
      GeneratedInboxSchema.parse(
        createInbox({
          papers: [
            createPaper({
              title: " "
            })
          ]
        })
      )
    ).toThrow();
  });

  it("accepts the inbox job input bundle sent to Codex", () => {
    const input = InboxGenerationJobInputSchema.parse(createJobInput());

    expect(input.profile.maxIdeas).toBe(10);
  });

  it("rejects job input profile limits that do not match v2 constants", () => {
    expect(() =>
      InboxGenerationJobInputSchema.parse(
        createJobInput({
          profile: createJobProfile({
            maxIdeas: 11
          })
        })
      )
    ).toThrow();

    expect(() =>
      InboxGenerationJobInputSchema.parse(
        createJobInput({
          profile: createJobProfile({
            maxIdeasPerPaper: 4
          })
        })
      )
    ).toThrow();
  });

  it("accepts strict viability verdicts", () => {
    const result = ViabilityResultSchema.parse({
      jobId: "job-1",
      verdict: "needs_novelty_check",
      summary: "Promising but related work is unresolved.",
      feasibility: "A small pilot can be run.",
      noveltyRisk: "Adjacent work exists.",
      minimumExperiment: "Create 20 examples and compare two baselines.",
      blockers: ["Need focused related-work search."],
      citations: [
        {
          sourceType: "paper",
          title: "Source",
          url: "https://arxiv.org/abs/2606.00001",
          sourceId: "2606.00001",
          claim: "Grounded in source.",
          confidence: 0.9
        }
      ]
    });

    expect(result.verdict).toBe("needs_novelty_check");
  });

  it("clamps unit scores to finite values between 0 and 1", () => {
    expect(clampUnitScore(Number.NaN)).toBe(0);
    expect(clampUnitScore(-0.5)).toBe(0);
    expect(clampUnitScore(1.5)).toBe(1);
    expect(clampUnitScore(0.1234)).toBe(0.123);
    expect(clampUnitScore(0.1235)).toBe(0.124);
  });
});
