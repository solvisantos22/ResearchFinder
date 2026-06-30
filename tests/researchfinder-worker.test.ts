import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VIABILITY_VERDICTS } from "@/lib/v2/domain";
import { parseInboxGenerationOutput, parseViabilityOutput } from "@/worker/output-validation";
import {
  buildAnalysisPrompt,
  buildExperimentPrompt,
  buildPaperPrompt,
  buildResearchPlanPrompt,
  collectArtifactDeliverablePaths,
  provisionCriticDeliverables,
  runResearchFinderWorker,
  runResearchFinderWorkerOnce
} from "../scripts/researchfinder-worker";
import type {
  AnalysisJobInput,
  ExperimentJobInput,
  PaperJobInput,
  ResearchPlanJobInput
} from "@/lib/v2/schemas";

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

    const processed = await runResearchFinderWorkerOnce(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token",
        codexCommand: "codex-test"
      },
      { runCodex }
    );

    expect(processed).toBe(true);
    expect(runCodex).toHaveBeenCalledWith(expect.any(String), { codexCommand: "codex-test" });
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/inbox-job-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody.type).toBe("inbox_generation");
    expect(parseInboxGenerationOutput(JSON.stringify(completionBody.output))).toEqual(codexOutput);
  });

  it("writes the exact generated inbox JSON contract into inbox generation prompts", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ job: createInboxGenerationJob("inbox-job-1") }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodex = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(createInboxCodexOutput());
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorkerOnce(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { runCodex }
    );

    expect(promptText).toContain('"source": "arxiv"');
    expect(promptText).toContain('"whyPaperMatters": "');
    expect(promptText).toContain('"expandedExplanation": "');
    expect(promptText).toContain('"scoreExplanations": {');
    expect(promptText).toContain('"smallestViabilitySprint": "');
    expect(promptText).toContain(
      "Do not return alternate keys such as whyRelevant, feasibility, expectedOutput, or sources."
    );
  });

  it("reports invalid Codex inbox output to the completion endpoint before throwing", async () => {
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
      .mockResolvedValueOnce(createJsonResponse({ error: "Generated inbox schema error" }, { status: 400 }));
    const runCodex = vi.fn().mockResolvedValue("{not valid json");
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      runResearchFinderWorkerOnce(
        {
          appUrl: "https://research.example.com",
          workerToken: "worker-token"
        },
        { runCodex }
      )
    ).rejects.toThrow("Worker completion failed with 400");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/inbox-job-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody).toEqual({
      type: "inbox_generation",
      output: "{not valid json"
    });
  });

  it("reports Codex process failures to the completion endpoint before throwing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ job: createInboxGenerationJob("inbox-job-1") }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    const runCodex = vi.fn().mockRejectedValue(new Error("Codex CLI is not authenticated"));
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      runResearchFinderWorkerOnce(
        {
          appUrl: "https://research.example.com",
          workerToken: "worker-token"
        },
        { runCodex }
      )
    ).rejects.toThrow("Codex CLI is not authenticated");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/inbox-job-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody).toEqual({
      type: "inbox_generation",
      error: "Codex CLI is not authenticated"
    });
  });

  it("completes claimed viability jobs with validated Codex output", async () => {
    const codexOutput = {
      jobId: "viability-job-1",
      verdict: "needs_novelty_check",
      summary: "Codex found the project plausible after checking the idea and source paper.",
      feasibility: "A small sprint can create the benchmark slice and compare two baselines.",
      noveltyRisk: "Related-work overlap still needs a focused search before paper writing.",
      minimumExperiment: "Create 20 examples.",
      blockers: ["Need access to baseline model outputs."],
      citations: [
        {
          sourceType: "paper",
          title: "Benchmark paper",
          url: "https://arxiv.org/abs/2606.00001",
          sourceId: "paper-1",
          claim: "The paper motivates the benchmark direction.",
          confidence: 0.91
        }
      ]
    };
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
    let promptText = "";
    const runCodex = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(codexOutput);
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token",
        codexCommand: "codex-test"
      },
      { runCodex }
    );

    expect(processed).toBe(true);
    expect(runCodex).toHaveBeenCalledWith(expect.any(String), { codexCommand: "codex-test" });
    expect(promptText).toContain(`- verdict: one of ${VIABILITY_VERDICTS.join(", ")}.`);
    expect(promptText).not.toContain("viable, needs_novelty_check, too_risky, blocked");
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
    expect(parseViabilityOutput(JSON.stringify(completionBody.output))).toEqual(codexOutput);
  });

  it("reports invalid Codex viability output to the completion endpoint before throwing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ job: createViabilityJob("viability-job-1") }))
      .mockResolvedValueOnce(createJsonResponse({ error: "Viability schema error" }, { status: 400 }));
    const runCodex = vi.fn().mockResolvedValue("{not valid json");
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      runResearchFinderWorkerOnce(
        {
          appUrl: "https://research.example.com",
          workerToken: "worker-token"
        },
        { runCodex }
      )
    ).rejects.toThrow("Worker completion failed with 400");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/viability-job-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody).toEqual({
      type: "viability_check",
      output: "{not valid json"
    });
  });

  it("returns false from one-shot mode when no job is available", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(createJsonResponse({ job: null }));
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      runResearchFinderWorkerOnce({
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      })
    ).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("drains multiple queued jobs without sleeping between processed jobs", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ job: createViabilityJob("viability-job-1") }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }))
      .mockResolvedValueOnce(createJsonResponse({ job: createViabilityJob("viability-job-2") }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const runCodex = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(createViabilityCodexOutput("viability-job-1")))
      .mockResolvedValueOnce(JSON.stringify(createViabilityCodexOutput("viability-job-2")));
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { runCodex, sleep, maxIterations: 2 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://research.example.com/api/workers/claim");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/viability-job-1/complete"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://research.example.com/api/workers/claim");
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/viability-job-2/complete"
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not sleep before the next claim after invalid Codex output is reported", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ job: createInboxGenerationJob("inbox-job-1") }))
      .mockResolvedValueOnce(
        createJsonResponse({ error: "Generated inbox schema error" }, { status: 400 })
      )
      .mockResolvedValueOnce(createJsonResponse({ job: createViabilityJob("viability-job-1") }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    const runCodex = vi.fn().mockResolvedValue("{not valid json");
    runCodex.mockResolvedValueOnce("{not valid json");
    runCodex.mockResolvedValueOnce(JSON.stringify(createViabilityCodexOutput("viability-job-1")));
    const sleep = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { runCodex, sleep, maxIterations: 2 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://research.example.com/api/workers/claim");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/inbox-job-1/complete"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://research.example.com/api/workers/claim");
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/viability-job-1/complete"
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it("sleeps before the next claim after transient completion outages", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ job: createViabilityJob("viability-job-1") }))
      .mockResolvedValueOnce(
        createJsonResponse({ error: "Completion service unavailable" }, { status: 503 })
      )
      .mockResolvedValueOnce(createJsonResponse({ job: createViabilityJob("viability-job-2") }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const runCodex = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(createViabilityCodexOutput("viability-job-1")))
      .mockResolvedValueOnce(JSON.stringify(createViabilityCodexOutput("viability-job-2")));
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { runCodex, sleep, maxIterations: 2 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://research.example.com/api/workers/claim");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/viability-job-1/complete"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://research.example.com/api/workers/claim");
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/viability-job-2/complete"
    );
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it("sleeps and retries after claim rate limit responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ error: "Rate limited" }, { status: 429 }))
      .mockResolvedValueOnce(createJsonResponse({ job: createViabilityJob("viability-job-1") }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const runCodex = vi.fn().mockResolvedValue(JSON.stringify(createViabilityCodexOutput("viability-job-1")));
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { runCodex, sleep, pollMs: 1234, maxIterations: 2 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://research.example.com/api/workers/claim");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://research.example.com/api/workers/claim");
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/viability-job-1/complete"
    );
    expect(console.error).toHaveBeenCalledWith("Worker claim failed with 429: Rate limited");
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(1234);
  });

  it("exits the polling loop on fatal claim authorization errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      createJsonResponse({ error: "Unauthorized" }, { status: 401 })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runResearchFinderWorker(
        {
          appUrl: "https://research.example.com",
          workerToken: "bad-worker-token"
        },
        { sleep, maxIterations: 3 }
      )
    ).rejects.toThrow("Worker claim failed with 401");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("exits the polling loop on malformed config objects", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const config = null as unknown as Parameters<typeof runResearchFinderWorker>[0];
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runResearchFinderWorker(config, { sleep, maxIterations: 1 })).rejects.toThrow(
      "ResearchFinder worker config must be an object"
    );

    expect(sleep).not.toHaveBeenCalled();
  });

  it("sleeps between polls when no job is available", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ job: null }))
      .mockResolvedValueOnce(createJsonResponse({ job: null }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { sleep, pollMs: 1234, maxIterations: 2 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(1234);
  });

  it("completes claimed research_literature jobs with scholarly retrieval and validated Codex output", async () => {
    const codexOutput = {
      researchProjectId: "proj-1",
      relationToSourcePaper: "Extends the source paper's findings with a focused literature review.",
      relatedWorks: [
        {
          title: "Related benchmark work",
          summary: "A related benchmark in the same area.",
          relationToProposed: "Adjacent methodology."
        }
      ],
      themes: ["benchmark evaluation"],
      gaps: ["No direct comparison to the source paper approach"],
      positioning: "This work fills the gap by synthesizing related literature.",
      citations: [
        {
          sourceType: "paper",
          title: "P",
          url: "https://arxiv.org/abs/2501.00001",
          sourceId: "2501.00001",
          claim: "Source paper motivates the literature review.",
          confidence: 0.9
        }
      ]
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_literature",
            id: "lit-1",
            input: {
              jobId: "lit-1",
              userId: "u1",
              researchProjectId: "proj-1",
              idea: {
                id: "i1",
                title: "T",
                summary: "S",
                expandedExplanation: "E",
                trajectory: "Tr",
                smallestSprint: "Sm"
              },
              paper: {
                id: "p1",
                arxivId: "2501.00001",
                title: "P",
                abstract: "A",
                url: "https://arxiv.org/abs/2501.00001",
                authors: [],
                categories: [],
                publishedAt: new Date().toISOString()
              },
              plan: {
                relationToSourcePaper: "x",
                hypotheses: ["h1"],
                experimentalDesign: "d",
                metrics: ["m"]
              },
              citations: [],
              feedback: "Prior critic: verify every citation URL."
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodex = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(codexOutput);
    });
    const gatherNoveltySourceEvidence = vi.fn().mockResolvedValue({
      adaptersAttempted: [],
      adaptersFailed: [],
      evidence: []
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { runCodex, gatherNoveltySourceEvidence }
    );

    expect(processed).toBe(true);
    expect(gatherNoveltySourceEvidence).toHaveBeenCalled();
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/lit-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody.type).toBe("research_literature");
    expect(completionBody.output.researchProjectId).toBe("proj-1");
    expect(promptText.toLowerCase()).toContain("availableresources");
    expect(promptText.toLowerCase()).toContain("never invent");
    expect(promptText).toContain("Prior critic: verify every citation URL.");
  });

  it("completes claimed research_experiment jobs with an agentic run and validated output", async () => {
    const codexOutput = {
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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_experiment",
            id: "exp-1",
            input: {
              jobId: "exp-1",
              userId: "user-1",
              researchProjectId: "proj-1",
              idea: {
                id: "idea-1",
                title: "Idea",
                summary: "Summary",
                expandedExplanation: "Explanation",
                trajectory: "Trajectory",
                smallestSprint: "Sprint"
              },
              paper: {
                id: "paper-1",
                arxivId: "2401.00001",
                title: "Source Paper",
                abstract: "Abstract.",
                url: "https://arxiv.org/abs/2401.00001",
                authors: ["A. Author"],
                categories: ["cs.LG"],
                publishedAt: "2024-01-01T00:00:00.000Z"
              },
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
              citations: [],
              feedback: "Prior critic: use the full dataset, not a subset."
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodexAgentic = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(codexOutput);
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token",
        codexCommand: "codex-test"
      },
      { runCodexAgentic, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(runCodexAgentic).toHaveBeenCalledTimes(1);
    expect(promptText).not.toContain("minimal research experiment");
    expect(promptText).not.toContain("smallest credible experiment");
    expect(promptText).toContain("INPUT.json");
    expect(promptText.toLowerCase()).toContain("real data");
    expect(promptText.toLowerCase()).toContain("never fabricate");
    expect(promptText).toContain("Prior critic: use the full dataset, not a subset.");
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/exp-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody.type).toBe("research_experiment");
    expect(completionBody.output).toEqual(codexOutput);
  });

  it("completes claimed research_analysis jobs with an agentic run and validated output", async () => {
    const codexOutput = {
      researchProjectId: "proj-1",
      relationToSourcePaper: "Analyzes the source paper's method results.",
      successCriteriaAssessment: [
        { criterion: "Beat baseline by >2%.", status: "met", evidence: "Accuracy +4% (p<0.05)." }
      ],
      statisticalFindings: [
        { description: "Accuracy delta", method: "paired t-test", value: "p=0.03", interpretation: "Significant." }
      ],
      keyFindings: ["The method significantly beats the baseline."],
      artifacts: [{ path: "analysis/accuracy.png", caption: "Accuracy vs baseline", kind: "figure", bytes: 20480 }],
      comparisonToBaselines: "Outperforms the vanilla baseline.",
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

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_analysis",
            id: "ana-1",
            input: {
              jobId: "ana-1",
              userId: "user-1",
              researchProjectId: "proj-1",
              idea: {
                id: "idea-1", title: "Idea", summary: "Summary",
                expandedExplanation: "Explanation", trajectory: "Trajectory", smallestSprint: "Sprint"
              },
              paper: {
                id: "paper-1", arxivId: "2401.00001", title: "Source Paper", abstract: "Abstract.",
                url: "https://arxiv.org/abs/2401.00001", authors: ["A. Author"], categories: ["cs.LG"],
                publishedAt: "2024-01-01T00:00:00.000Z"
              },
              plan: {
                relationToSourcePaper: "Extends it.",
                hypotheses: ["H1"],
                successCriteria: ["Beat baseline by >2%."],
                metrics: ["accuracy"],
                baselines: ["vanilla"],
                experimentalDesign: "A/B on a small split."
              },
              literature: { positioning: "Novel.", gaps: ["No small-scale ablation."] },
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
              citations: [],
              feedback: "Prior critic: report confidence intervals."
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodexAgentic = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(codexOutput);
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token",
        codexCommand: "codex-test"
      },
      { runCodexAgentic, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(runCodexAgentic).toHaveBeenCalledTimes(1);
    // Analysis runs at the project root (so it can read the sibling experiment/ outputs),
    // NOT the analysis/ subdir — lock that in.
    const analysisCall = runCodexAgentic.mock.calls[0] as unknown as [string, { workspaceDir?: string }];
    expect(analysisCall?.[1]?.workspaceDir).toMatch(/[\\/]proj-1$/);
    expect(promptText).toContain("INPUT.json");
    expect(promptText).toContain("analysis/");
    expect(promptText.toLowerCase()).toContain("confidence interval");
    expect(promptText.toLowerCase()).toContain("effect size");
    expect(promptText).toContain("Prior critic: report confidence intervals.");
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/ana-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody.type).toBe("research_analysis");
    expect(completionBody.output).toEqual(codexOutput);
  });

  it("completes a claimed research critic job with an agentic stub run and validated verdict", async () => {
    const verdictOutput = {
      researchProjectId: "proj-1",
      stageType: "plan",
      verdict: "PASS",
      scorecard: [{ criterion: "Phase-1 stub", pass: true, note: "Looks adequate for the spine." }]
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_plan_critic",
            id: "plan-critic-1",
            input: {
              researchProjectId: "proj-1",
              stageType: "plan",
              artifactToJudge: { researchProjectId: "proj-1", hypotheses: ["H1"] },
              sourcePaper: {
                id: "p1", arxivId: "2401.00001", title: "Source Paper", abstract: "A.",
                url: "https://arxiv.org/abs/2401.00001", authors: [], categories: [],
                publishedAt: "2024-01-01T00:00:00.000Z"
              },
              criteria: "plan criteria placeholder — Phase 2 fills this in"
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodexAgentic = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(verdictOutput);
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      { appUrl: "https://research.example.com", workerToken: "worker-token", codexCommand: "codex-test" },
      { runCodexAgentic, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(runCodexAgentic).toHaveBeenCalledTimes(1);
    expect(promptText).toContain("CriticVerdict");
    expect(promptText).toContain("PASS|REDO|BACKTRACK");
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/plan-critic-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody.type).toBe("research_plan_critic");
    expect(completionBody.output).toEqual(verdictOutput);
  });

  it("writes upstream artifacts and references them in the critic prompt", async () => {
    const verdictOutput = {
      researchProjectId: "proj-1",
      stageType: "experiment",
      verdict: "PASS",
      scorecard: [{ criterion: "Real data", pass: true, note: "Provenance traceable." }]
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_experiment_critic",
            id: "exp-critic-1",
            input: {
              researchProjectId: "proj-1",
              stageType: "experiment",
              artifactToJudge: { researchProjectId: "proj-1", findings: ["f1"] },
              upstreamArtifacts: [
                { stageType: "plan", artifact: { researchProjectId: "proj-1", marker: "PLAN" } },
                { stageType: "literature", artifact: { researchProjectId: "proj-1", marker: "LIT" } }
              ],
              sourcePaper: {
                id: "p1", arxivId: "2401.00001", title: "Source Paper", abstract: "A.",
                url: "https://arxiv.org/abs/2401.00001", authors: [], categories: [],
                publishedAt: "2024-01-01T00:00:00.000Z"
              },
              criteria: "Evaluate the experiment artifact. 1. Real data with real provenance."
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodexAgentic = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(verdictOutput);
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      { appUrl: "https://research.example.com", workerToken: "worker-token", codexCommand: "codex-test" },
      { runCodexAgentic, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(promptText).toContain("UPSTREAM_plan.json");
    expect(promptText).toContain("UPSTREAM_literature.json");
    expect(promptText).toContain("Real data with real provenance");
    // The existing JSON-shape contract must still hold:
    expect(promptText).toContain("CriticVerdict");
    expect(promptText).toContain("PASS|REDO|BACKTRACK");
  });

  it("completes claimed novelty scan jobs with source evidence and validated Codex output", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "novelty_scan",
            id: "novelty-job-1",
            input: {
              jobId: "novelty-job-1",
              userId: "user-1",
              inboxDate: "2026-06-25",
              profile: {
                fieldPreset: "ai_ml",
                keywords: ["agent evaluation"],
                constraints: [],
                preferredOutputs: ["benchmark"],
                allowRelatedWorkSearch: true
              },
              ideas: [
                {
                  id: "idea-1",
                  title: "AutoBenchsmith",
                  summary: "Generate benchmark items.",
                  expandedExplanation: "Expanded.",
                  trajectory: "Trajectory.",
                  smallestSprint: "Build a pilot.",
                  paper: {
                    id: "paper-1",
                    arxivId: "2606.00001",
                    title: "Paper title",
                    abstract: "Paper abstract",
                    url: "https://arxiv.org/abs/2606.00001",
                    authors: ["A. Researcher"],
                    categories: ["cs.AI"],
                    publishedAt: "2026-06-25T00:00:00.000Z"
                  }
                }
              ]
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    const runCodex = vi.fn().mockResolvedValue(
      JSON.stringify({
        jobId: "novelty-job-1",
        generatedForUserId: "user-1",
        inboxDate: "2026-06-25",
        scans: [
          {
            generatedIdeaId: "idea-1",
            status: "completed",
            label: "unclear",
            confidence: 0.64,
            summary: "Adjacent evidence exists.",
            overlapExplanation: "No exact duplicate was found in the bounded scan.",
            queries: ["AutoBenchsmith benchmark"],
            adaptersAttempted: ["arxiv"],
            adaptersFailed: [],
            evidence: [
              {
                sourceType: "arxiv",
                title: "Adjacent source",
                url: "https://arxiv.org/abs/2606.00002",
                sourceId: "2606.00002",
                claim: "Adjacent benchmark generation work exists.",
                overlapLevel: "adjacent",
                confidence: 0.61
              }
            ]
          }
        ]
      })
    );
    const gatherNoveltySourceEvidence = vi.fn().mockResolvedValue({
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
          confidence: 0.61
        }
      ]
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { runCodex, gatherNoveltySourceEvidence }
    );

    expect(processed).toBe(true);
    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(completionBody.type).toBe("novelty_scan");
    expect(completionBody.output.scans[0].label).toBe("unclear");
  });

  it("completes claimed research_paper jobs with an agentic run and validated output", async () => {
    const codexOutput = {
      researchProjectId: "proj-1",
      relationToSourcePaper: "Extends the source paper's method to a new benchmark.",
      title: "A Rigorous Study of X",
      abstract: "We study X and find Y.",
      noveltyStatement: "First to evaluate X on the public Z benchmark with ablations.",
      sections: ["Introduction", "Related Work", "Method", "Experiments", "Results", "Conclusion"],
      texPath: "paper/main.tex",
      pdfPath: "paper/main.pdf",
      compiled: true,
      artifacts: [
        { path: "paper/main.pdf", caption: "Compiled paper", kind: "pdf", bytes: 240000 },
        { path: "analysis/fig1.png", caption: "Accuracy vs depth", kind: "figure", bytes: 30000 }
      ],
      summary: "A submittable workshop-grade draft.",
      citations: [
        {
          sourceType: "paper",
          title: "Source",
          url: "https://arxiv.org/abs/2501.00001",
          sourceId: "2501.00001",
          claim: "Foundational",
          confidence: 0.9
        }
      ]
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_paper",
            id: "paper-job-1",
            input: {
              jobId: "paper-job-1",
              userId: "user-1",
              researchProjectId: "proj-1",
              idea: {
                id: "i1", title: "T", summary: "S",
                expandedExplanation: "E", trajectory: "Tr", smallestSprint: "SS"
              },
              paper: {
                id: "p1", arxivId: "2501.00001", title: "Source", abstract: "A",
                url: "https://arxiv.org/abs/2501.00001",
                authors: ["Ada"], categories: ["cs.LG"],
                publishedAt: "2026-06-25T00:00:00.000Z"
              },
              plan: {
                relationToSourcePaper: "Extends.",
                hypotheses: ["H1"],
                successCriteria: ["beats baseline"],
                metrics: ["acc"],
                baselines: ["ResNet"],
                experimentalDesign: "ablation"
              },
              literature: { positioning: "We close the Z gap.", gaps: ["no open benchmark"] },
              experiment: { summary: "Ran full study.", verdict: "success", findings: ["X improves Y"] },
              analysis: {
                summary: "Supports hypotheses.", verdict: "supports_hypotheses",
                keyFindings: ["+4% acc"], comparisonToBaselines: "Beats ResNet."
              },
              citations: [{
                sourceType: "paper", title: "Source",
                url: "https://arxiv.org/abs/2501.00001", sourceId: "2501.00001",
                claim: "Foundational", confidence: 0.9
              }],
              feedback: "Prior critic: tighten the abstract."
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodexAgentic = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(codexOutput);
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token",
        codexCommand: "codex-test"
      },
      { runCodexAgentic, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(runCodexAgentic).toHaveBeenCalledTimes(1);
    expect(promptText.toLowerCase()).toContain("latex");
    expect(promptText.toLowerCase()).toContain("tectonic");
    expect(promptText).toContain("paper/main.tex");
    expect(promptText).toContain("Prior critic: tighten the abstract.");
    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(completionBody.type).toBe("research_paper");
    expect(completionBody.output.compiled).toBe(true);
  });

  it("plan prompt demands rigor, drops the 'smallest' framing, and injects prior feedback", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_plan",
            id: "plan-redo-1",
            input: {
              jobId: "plan-redo-1", userId: "u1", researchProjectId: "proj-1",
              idea: { id: "i1", title: "T", summary: "S", expandedExplanation: "E", trajectory: "Tr", smallestSprint: "SS" },
              paper: {
                id: "p1", arxivId: "2401.00001", title: "Src", abstract: "A.",
                url: "https://arxiv.org/abs/2401.00001", authors: [], categories: [],
                publishedAt: "2024-01-01T00:00:00.000Z"
              },
              viability: null,
              citations: [{ sourceType: "paper", title: "Src", url: "https://arxiv.org/abs/2401.00001", sourceId: "2401.00001", claim: "Foundational", confidence: 0.9 }],
              feedback: "Add multiple seeds and an ablation over depth."
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodex = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify({
        researchProjectId: "proj-1", relationToSourcePaper: "Extends src.",
        hypotheses: ["H1"], experimentalDesign: "D", protocolSteps: ["S1"], datasets: ["CIFAR-10"],
        baselines: ["ResNet-18"], metrics: ["acc"], successCriteria: ["beats baseline"], computeEstimate: "1 GPU-day",
        risks: ["r"], citations: [{ sourceType: "paper", title: "Src", url: "https://arxiv.org/abs/2401.00001", sourceId: "2401.00001", claim: "Foundational", confidence: 0.9 }]
      });
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      { appUrl: "https://research.example.com", workerToken: "worker-token", codexCommand: "codex-test" },
      { runCodex, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(promptText).not.toContain("smallest credible experiment");
    expect(promptText.toLowerCase()).toContain("real");
    expect(promptText.toLowerCase()).toContain("ablation");
    expect(promptText).toContain("Add multiple seeds and an ablation over depth.");
  });
});

function createInboxGenerationJob(id: string) {
  return {
    type: "inbox_generation",
    id,
    input: {
      jobId: id,
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
  };
}

function createInboxCodexOutput() {
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
        whyPaperMatters: "This paper opens a concrete evaluation direction.",
        ideas: [
          {
            title: "Build a benchmark slice",
            summary: "Evaluate a small benchmark slice.",
            expandedExplanation: "Create a focused benchmark from the paper.",
            trajectory: "Start with a pilot, then expand if the result is novel.",
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
              relevance: "Directly aligned with the profile.",
              significance: "Could become a useful benchmark paper.",
              originality: "Needs related-work review.",
              feasibility: "A small pilot is feasible.",
              overall: "Strong enough to surface."
            },
            risks: ["Adjacent benchmarks may already cover this."],
            smallestViabilitySprint: "Create 20 examples and compare two baselines.",
            citations: [
              {
                sourceType: "paper",
                title: "Paper title",
                url: "https://arxiv.org/abs/2606.00001",
                sourceId: "2606.00001",
                claim: "The source paper motivates the benchmark direction.",
                confidence: 0.92
              }
            ]
          }
        ]
      }
    ]
  };
}

function createViabilityJob(id: string) {
  return {
    type: "viability_check",
    id,
    input: {
      jobId: id,
      userId: "user-1",
      sprintDepth: "default",
      autonomyLevel: "medium",
      idea: {
        id: `idea-${id}`,
        title: "Build a benchmark slice",
        summary: "Evaluate a small benchmark slice.",
        details: "Create a focused pilot.",
        smallestSprint: "Create 20 examples."
      },
      paper: {
        id: `paper-${id}`,
        title: "Benchmark paper",
        abstract: "Paper abstract",
        url: "https://arxiv.org/abs/2606.00001",
        authors: ["A. Researcher"],
        categories: ["cs.AI"],
        publishedAt: "2026-06-23T00:00:00.000Z"
      },
      citations: []
    }
  };
}

function createViabilityCodexOutput(jobId: string) {
  return {
    jobId,
    verdict: "needs_novelty_check",
    summary: `Codex viability summary for ${jobId}.`,
    feasibility: "A small sprint can create a benchmark slice and compare two baselines.",
    noveltyRisk: "Related-work overlap still needs a focused search before paper writing.",
    minimumExperiment: "Create 20 examples.",
    blockers: ["Need access to baseline model outputs."],
    citations: [
      {
        sourceType: "paper",
        title: "Benchmark paper",
        url: "https://arxiv.org/abs/2606.00001",
        sourceId: `paper-${jobId}`,
        claim: "The paper motivates the benchmark direction.",
        confidence: 0.91
      }
    ]
  };
}

describe("producer prompts encode the Bucket 1 scientific-rigor gates", () => {
  const base = { researchProjectId: "proj-1" };

  it("plan prompt demands construct validation, a task-competence gate, and design-faithful stats", () => {
    const p = buildResearchPlanPrompt(base as unknown as ResearchPlanJobInput).toLowerCase();
    expect(p).toContain("construct-validation");
    expect(p).toContain("task-competence gate");
    expect(p).toMatch(/power\/mde|minimum-detectable/);
  });

  it("experiment prompt requires a benchmark validation artifact before the full run", () => {
    const p = buildExperimentPrompt(base as unknown as ExperimentJobInput).toLowerCase();
    expect(p).toContain("benchmark_validation.jsonl");
  });

  it("analysis prompt requires scoring validation and a non-degenerate lure metric", () => {
    const p = buildAnalysisPrompt(base as unknown as AnalysisJobInput).toLowerCase();
    expect(p).toMatch(/audit the parser|scoring validation|validate scoring/);
    expect(p).toMatch(/exceeds|chance wrong-answer|non-lure/);
  });

  it("paper prompt requires benchmark-audit sections and a release card", () => {
    const p = buildPaperPrompt(base as unknown as PaperJobInput).toLowerCase();
    expect(p).toMatch(/item pair|item-pair/);
    expect(p).toContain("release card");
  });
});

describe("stage-critic deliverable provisioning", () => {
  it("collects only safe relative file paths referenced by an artifact", () => {
    const paths = collectArtifactDeliverablePaths({
      texPath: "paper/main.tex",
      pdfPath: "paper/main.pdf",
      artifacts: [{ path: "analysis/figure_1.png" }, { path: "analysis/table.csv" }],
      caption: "see the results in the table",
      summary: "A prose summary that mentions notes.txt but is not a path field."
    });

    expect([...paths].sort()).toEqual(
      ["analysis/figure_1.png", "analysis/table.csv", "paper/main.pdf", "paper/main.tex"].sort()
    );
  });

  it("ignores absolute paths and parent-directory traversal", () => {
    const paths = collectArtifactDeliverablePaths({
      artifacts: [{ path: "/etc/passwd" }, { path: "../../secrets.txt" }, { path: "paper/ok.tex" }]
    });

    expect(paths).toEqual(["paper/ok.tex"]);
  });

  it("copies referenced deliverables into the critic workspace so declared paths resolve", async () => {
    const root = await mkdtemp(join(tmpdir(), "critic-deliverables-"));
    const projectRoot = join(root, "proj-1");
    await mkdir(join(projectRoot, "paper"), { recursive: true });
    await mkdir(join(projectRoot, "analysis"), { recursive: true });
    await writeFile(join(projectRoot, "paper", "main.tex"), "\\documentclass{article}", "utf8");
    await writeFile(join(projectRoot, "paper", "main.pdf"), "%PDF-1.5 fake", "utf8");
    await writeFile(join(projectRoot, "analysis", "figure_1.png"), "PNGDATA", "utf8");

    const criticDir = join(projectRoot, "paper-critic");
    await mkdir(criticDir, { recursive: true });

    const artifact = {
      texPath: "paper/main.tex",
      pdfPath: "paper/main.pdf",
      artifacts: [
        { path: "paper/main.tex", kind: "tex" },
        { path: "analysis/figure_1.png", kind: "figure" },
        { path: "analysis/missing_table.csv", kind: "table" }
      ]
    };

    const copied = await provisionCriticDeliverables(criticDir, artifact);

    // The declared relative paths now resolve from inside the critic workspace.
    expect(await readFile(join(criticDir, "paper", "main.pdf"), "utf8")).toBe("%PDF-1.5 fake");
    expect(await readFile(join(criticDir, "analysis", "figure_1.png"), "utf8")).toBe("PNGDATA");
    expect(copied.sort()).toEqual(["analysis/figure_1.png", "paper/main.pdf", "paper/main.tex"].sort());
    // A referenced-but-absent source file is skipped, not fatal.
    expect(copied).not.toContain("analysis/missing_table.csv");
  });
});
