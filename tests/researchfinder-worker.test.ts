import { afterEach, describe, expect, it, vi } from "vitest";

import { parseInboxGenerationOutput, parseViabilityOutput } from "@/worker/output-validation";
import { runResearchFinderWorker } from "../scripts/researchfinder-worker";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function createJsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

describe("researchfinder local worker", () => {
  it("completes claimed inbox generation jobs with validated Codex output", async () => {
    const codexOutput = {
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
          whyPaperMatters: "This paper opens a concrete evaluation direction.",
          ideas: [
            {
              title: "Build a stress-test benchmark",
              summary: "Create a focused benchmark slice.",
              expandedExplanation: "Turn the paper into a practical benchmark pilot.",
              trajectory: "If the pilot works, expand it into a benchmark paper.",
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
                significance: "Could support a useful benchmark contribution.",
                originality: "The exact framing still needs related-work review.",
                feasibility: "A small pilot can be built quickly.",
                overall: "Strong enough to surface in the inbox."
              },
              risks: ["Adjacent benchmarks may already cover this stress test."],
              smallestViabilitySprint: "Create 20 examples and compare two baselines.",
              citations: [
                {
                  sourceType: "paper",
                  title: "Paper title",
                  url: "https://arxiv.org/abs/2606.00001",
                  sourceId: "2606.00001",
                  claim: "The paper motivates the benchmark direction.",
                  confidence: 0.93
                }
              ]
            }
          ]
        }
      ]
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "inbox_generation",
            id: "inbox-job-1",
            input: {
              jobId: "inbox-job-1",
              userId: "user-1",
              inboxDate: "2026-06-23",
              profile: {
                fieldPreset: "ai_ml",
                keywords: ["LLM evaluation"],
                constraints: ["No frontier-scale training"],
                preferredOutputs: ["benchmark"],
                arxivQuery: "cat:cs.AI",
                maxIdeas: 10,
                maxIdeasPerPaper: 3
              },
              candidatePapers: [
                {
                  sourceId: "2606.00001",
                  title: "Paper title",
                  abstract: "Paper abstract",
                  url: "https://arxiv.org/abs/2606.00001",
                  authors: ["A. Researcher"],
                  categories: ["cs.AI"],
                  publishedAt: "2026-06-23T00:00:00.000Z"
                }
              ]
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    const runCodex = vi.fn().mockResolvedValue(JSON.stringify(codexOutput));
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token",
        codexCommand: "codex-test"
      },
      { runCodex }
    );

    expect(runCodex).toHaveBeenCalledWith(expect.any(String), { codexCommand: "codex-test" });
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/inbox-job-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody.type).toBe("inbox_generation");
    expect(parseInboxGenerationOutput(JSON.stringify(completionBody.output))).toEqual(codexOutput);
  });

  it("completes claimed viability jobs with a validated deterministic result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "viability_check",
            id: "viability-job-1",
            input: {
              jobId: "viability-job-1",
              userId: "user-1",
              sprintDepth: "default",
              autonomyLevel: "medium",
              idea: {
                id: "idea-1",
                title: "Build a benchmark slice",
                summary: "Evaluate a small benchmark slice.",
                details: "Create a focused pilot.",
                smallestSprint: "Create 20 examples."
              },
              paper: {
                id: "paper-1",
                title: "Benchmark paper",
                abstract: "Paper abstract",
                url: "https://arxiv.org/abs/2606.00001",
                authors: ["A. Researcher"],
                categories: ["cs.AI"],
                publishedAt: "2026-06-23T00:00:00.000Z"
              },
              citations: []
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker({
      appUrl: "https://research.example.com",
      workerToken: "worker-token"
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://research.example.com/api/workers/claim", {
      method: "POST",
      headers: {
        authorization: "Bearer worker-token"
      }
    });

    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/viability-job-1/complete"
    );
    expect(completionRequest?.[1]).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer worker-token",
        "content-type": "application/json"
      }
    });

    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody.type).toBe("viability_check");
    const parsedOutput = parseViabilityOutput(JSON.stringify(completionBody.output));
    expect(parsedOutput).toMatchObject({
      jobId: "viability-job-1",
      verdict: "needs_novelty_check",
      summary: expect.stringContaining("local worker")
    });
    expect(parsedOutput.citations).toEqual([
      expect.objectContaining({
        sourceType: "paper",
        title: "Benchmark paper",
        url: "https://arxiv.org/abs/2606.00001"
      })
    ]);
  });
});
