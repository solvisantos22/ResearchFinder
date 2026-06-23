import { describe, expect, it } from "vitest";

import {
  GeneratedInboxSchema,
  InboxGenerationJobInputSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";

describe("v2 worker schemas", () => {
  it("accepts a generated inbox with 10 or fewer ideas and at most 3 ideas per paper", () => {
    const result = GeneratedInboxSchema.parse({
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
              citations: [
                {
                  sourceType: "paper",
                  title: "Paper title",
                  url: "https://arxiv.org/abs/2606.00001",
                  sourceId: "2606.00001",
                  claim: "The idea is grounded in the source paper.",
                  confidence: 0.95
                }
              ]
            }
          ]
        }
      ]
    });

    expect(result.papers[0].ideas[0].noveltyStatus).toBe("needs_novelty_check");
  });

  it("rejects inbox outputs with more than 3 ideas for one paper", () => {
    const paper = {
      source: "arxiv",
      sourceId: "2606.00001",
      title: "Paper title",
      abstract: "Paper abstract",
      url: "https://arxiv.org/abs/2606.00001",
      authors: ["A. Researcher"],
      categories: ["cs.AI"],
      publishedAt: "2026-06-23T00:00:00.000Z",
      whyPaperMatters: "Reason",
      ideas: Array.from({ length: 4 }, (_, index) => ({
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
          {
            sourceType: "paper",
            title: "Paper title",
            url: "https://arxiv.org/abs/2606.00001",
            sourceId: "2606.00001",
            claim: "Claim",
            confidence: 0.9
          }
        ]
      }))
    };

    expect(() =>
      GeneratedInboxSchema.parse({
        inboxDate: "2026-06-23",
        generatedForUserId: "user-1",
        papers: [paper]
      })
    ).toThrow();
  });

  it("accepts the inbox job input bundle sent to Codex", () => {
    const input = InboxGenerationJobInputSchema.parse({
      jobId: "job-1",
      userId: "user-1",
      inboxDate: "2026-06-23",
      profile: {
        fieldPreset: "ai_ml",
        keywords: ["agent evaluation"],
        constraints: ["No frontier-scale training"],
        preferredOutputs: ["benchmark"],
        arxivQuery: "cat:cs.AI",
        maxIdeas: 10,
        maxIdeasPerPaper: 3
      },
      candidatePapers: []
    });

    expect(input.profile.maxIdeas).toBe(10);
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
});
