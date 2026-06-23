import { afterEach, describe, expect, it, vi } from "vitest";

import { parseViabilityOutput } from "@/worker/output-validation";
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
