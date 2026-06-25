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

  it("rejects duplicate source papers even when each group stays under the per-paper idea limit", () => {
    expect(() =>
      GeneratedInboxSchema.parse(
        createInbox({
          papers: [
            createPaper({
              sourceId: "2606.00001",
              url: "https://arxiv.org/abs/2606.00001",
              ideas: Array.from({ length: 3 }, (_, index) =>
                createIdea({
                  title: `First group idea ${index}`,
                  citations: [
                    createCitation({
                      sourceId: "2606.00001",
                      url: "https://arxiv.org/abs/2606.00001"
                    })
                  ]
                })
              )
            }),
            createPaper({
              sourceId: "2606.00001",
              url: "https://arxiv.org/abs/2606.00001",
              ideas: Array.from({ length: 3 }, (_, index) =>
                createIdea({
                  title: `Second group idea ${index}`,
                  citations: [
                    createCitation({
                      sourceId: "2606.00001",
                      url: "https://arxiv.org/abs/2606.00001"
                    })
                  ]
                })
              )
            })
          ]
        })
      )
    ).toThrow(/repeats sourceId/);
  });

  it("rejects inbox outputs with more than 10 total ideas", () => {
    const papers = Array.from({ length: 4 }, (_, paperIndex) => {
      const sourceId = `2606.0000${paperIndex + 1}`;
      const url = `https://arxiv.org/abs/${sourceId}`;
      const title = `Paper ${paperIndex + 1}`;

      return createPaper({
        sourceId,
        url,
        title,
        ideas: Array.from({ length: 3 }, (_, index) =>
          createIdea({
            title: `Idea ${index}`,
            recommended: index === 0,
            citations: [
              createCitation({
                sourceId,
                title,
                url
              })
            ]
          })
        )
      });
    });

    expect(() =>
      GeneratedInboxSchema.parse(
        createInbox({
          papers
        })
      )
    ).toThrow(/contains 12 ideas; maximum is 10/);
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

  it("rejects non-http urls for citations, generated papers, and candidate papers", () => {
    const unsafeUrls = ["javascript:alert(1)", "mailto:test@example.com", "ftp://example.com/file"];

    expect(
      CitationSchema.parse(
        createCitation({
          url: "https://arxiv.org/abs/2606.00001"
        })
      ).url
    ).toBe("https://arxiv.org/abs/2606.00001");

    for (const url of unsafeUrls) {
      expect(() =>
        CitationSchema.parse(
          createCitation({
            url
          })
        )
      ).toThrow();

      expect(() =>
        GeneratedInboxSchema.parse(
          createInbox({
            papers: [
              createPaper({
                url,
                ideas: [
                  createIdea({
                    citations: [
                      createCitation({
                        url
                      })
                    ]
                  })
                ]
              })
            ]
          })
        )
      ).toThrow();

      expect(() =>
        InboxGenerationJobInputSchema.parse(
          createJobInput({
            candidatePapers: [
              {
                sourceId: "2606.00001",
                title: "Paper title",
                abstract: "Paper abstract",
                url,
                authors: ["A. Researcher"],
                categories: ["cs.AI"],
                publishedAt: "2026-06-23T00:00:00.000Z"
              }
            ]
          })
        )
      ).toThrow();
    }
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

  it("rejects generated and candidate papers without authors or categories", () => {
    for (const field of ["authors", "categories"] as const) {
      expect(() =>
        GeneratedInboxSchema.parse(
          createInbox({
            papers: [
              createPaper({
                [field]: []
              })
            ]
          })
        )
      ).toThrow();

      expect(() =>
        InboxGenerationJobInputSchema.parse(
          createJobInput({
            candidatePapers: [
              {
                sourceId: "2606.00001",
                title: "Paper title",
                abstract: "Paper abstract",
                url: "https://arxiv.org/abs/2606.00001",
                authors: field === "authors" ? [] : ["A. Researcher"],
                categories: field === "categories" ? [] : ["cs.AI"],
                publishedAt: "2026-06-23T00:00:00.000Z"
              }
            ]
          })
        )
      ).toThrow();
    }
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

  it("accepts calibrated novelty labels for generated inbox ideas", () => {
    for (const noveltyStatus of [
      "likely_novel",
      "unclear",
      "crowded",
      "near_duplicate",
      "not_checked"
    ]) {
      const result = GeneratedInboxSchema.parse(
        createInbox({
          papers: [
            createPaper({
              ideas: [
                createIdea({
                  noveltyStatus
                })
              ]
            })
          ]
        })
      );

      expect(result.papers[0].ideas[0].noveltyStatus).toBe(noveltyStatus);
    }
  });

  it("accepts novelty scan worker output with evidence and query traces", async () => {
    const { NoveltyScanResultSchema } = await import("@/lib/v2/schemas");
    const result = NoveltyScanResultSchema.parse({
      jobId: "novelty-job-1",
      generatedForUserId: "user-1",
      inboxDate: "2026-06-25",
      scans: [
        {
          generatedIdeaId: "idea-1",
          status: "completed",
          label: "crowded",
          confidence: 0.78,
          summary: "Several adjacent benchmark-generation systems exist.",
          overlapExplanation:
            "The idea is adjacent to agentic synthetic-data systems but remains distinct if scoped to benchmark failure discovery.",
          queries: ["AutoBenchsmith benchmark generation", "agentic synthetic benchmark data"],
          adaptersAttempted: ["arxiv", "openalex", "semantic_scholar", "web"],
          adaptersFailed: [],
          evidence: [
            {
              sourceType: "scholarly",
              title: "Autodata: An agentic data scientist to create high quality synthetic data",
              url: "https://arxiv.org/abs/2606.25996",
              sourceId: "2606.25996",
              claim: "The source introduces agentic synthetic data creation.",
              overlapLevel: "adjacent",
              confidence: 0.86
            }
          ]
        }
      ]
    });

    expect(result.scans[0].label).toBe("crowded");
  });

  it("rejects novelty scan outputs without evidence unless label is not_checked", async () => {
    const { NoveltyScanResultSchema } = await import("@/lib/v2/schemas");

    expect(() =>
      NoveltyScanResultSchema.parse({
        jobId: "novelty-job-1",
        generatedForUserId: "user-1",
        inboxDate: "2026-06-25",
        scans: [
          {
            generatedIdeaId: "idea-1",
            status: "completed",
            label: "likely_novel",
            confidence: 0.7,
            summary: "No close matches found.",
            overlapExplanation: "No strong overlap was found.",
            queries: ["query"],
            adaptersAttempted: ["arxiv"],
            adaptersFailed: [],
            evidence: []
          }
        ]
      })
    ).toThrow(/evidence/);

    const unchecked = NoveltyScanResultSchema.parse({
      jobId: "novelty-job-1",
      generatedForUserId: "user-1",
      inboxDate: "2026-06-25",
      scans: [
        {
          generatedIdeaId: "idea-1",
          status: "failed",
          label: "not_checked",
          confidence: 0,
          summary: "No source adapters completed.",
          overlapExplanation: "Novelty could not be assessed.",
          queries: [],
          adaptersAttempted: ["arxiv"],
          adaptersFailed: ["arxiv"],
          evidence: []
        }
      ]
    });

    expect(unchecked.scans[0].label).toBe("not_checked");
  });
});
