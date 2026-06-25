import { afterEach, describe, expect, it, vi } from "vitest";

import { gatherNoveltySourceEvidence } from "@/worker/novelty-sources";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("novelty source adapters", () => {
  it("returns partial evidence and records adapter failures", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          `<?xml version="1.0"?><feed><entry><id>https://arxiv.org/abs/2606.00002</id><title>Related benchmark generation</title><summary>Related abstract</summary><published>2026-06-24T00:00:00Z</published><updated>2026-06-24T00:00:00Z</updated><author><name>A. Author</name></author><category term="cs.AI"/></entry></feed>`,
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    const result = await gatherNoveltySourceEvidence({
      queries: ["benchmark generation"],
      maxResultsPerQuery: 1
    });

    expect(result.adaptersAttempted).toContain("arxiv");
    expect(result.adaptersFailed).toContain("openalex");
    expect(result.evidence[0]).toMatchObject({
      sourceType: "arxiv",
      title: "Related benchmark generation",
      sourceId: "2606.00002"
    });
  });
});
