import { afterEach, describe, expect, it, vi } from "vitest";

import { parseInboxGenerationOutput, parseViabilityOutput } from "@/worker/output-validation";
import {
  runResearchFinderWorker,
  runResearchFinderWorkerOnce
} from "../scripts/researchfinder-worker";

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

    const processed = await runResearchFinderWorkerOnce({
      appUrl: "https://research.example.com",
      workerToken: "worker-token"
    });

    expect(processed).toBe(true);
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
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { sleep, maxIterations: 2 }
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
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { sleep, maxIterations: 2 }
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
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token"
      },
      { sleep, pollMs: 1234, maxIterations: 2 }
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
