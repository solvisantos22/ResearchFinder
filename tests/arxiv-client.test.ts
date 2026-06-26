import { afterEach, describe, expect, it, vi } from "vitest";
import { arxivAtomFixture } from "@/lib/arxiv/fixtures";
import { fetchArxivPapers, parseArxivAtom } from "@/lib/arxiv/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseArxivAtom", () => {
  it("parses arXiv Atom entries into normalized papers", () => {
    const papers = parseArxivAtom(arxivAtomFixture);
    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      arxivId: "2606.20408v1",
      title: "LLM agent safety, multi-turn red-teaming, jailbreak benchmarks",
      url: "http://arxiv.org/abs/2606.20408v1",
      authors: ["Example Author"],
      categories: ["cs.AI", "cs.CL"]
    });
  });

  it("returns an empty array for an empty feed", () => {
    expect(parseArxivAtom(`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`)).toEqual([]);
  });

  it("parses multiple entries into multiple papers", () => {
    const papers = parseArxivAtom(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1</id>
    <updated>2026-06-21T12:00:00Z</updated>
    <published>2026-06-21T12:00:00Z</published>
    <title>First</title>
    <summary>One</summary>
    <author><name>A</name></author>
    <category term="cs.AI"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2</id>
    <updated>2026-06-22T12:00:00Z</updated>
    <published>2026-06-22T12:00:00Z</published>
    <title>Second</title>
    <summary>Two</summary>
    <author><name>B</name></author>
    <category term="cs.CL"/>
  </entry>
</feed>`);

    expect(papers).toHaveLength(2);
    expect(papers.map((paper) => paper.arxivId)).toEqual(["1", "2"]);
  });

  it("collapses whitespace in text fields", () => {
    const papers = parseArxivAtom(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2606.20408v1</id>
    <updated>2026-06-21T12:00:00Z</updated>
    <published>2026-06-21T12:00:00Z</published>
    <title>  Title   with
      extra   space  </title>
    <summary>  Summary
      with   spacing  </summary>
    <author><name>  Example
      Author  </name></author>
    <category term="cs.AI"/>
  </entry>
</feed>`);

    expect(papers[0]).toMatchObject({
      title: "Title with extra space",
      abstract: "Summary with spacing",
      authors: ["Example Author"]
    });
  });

  it("preserves legacy arxiv identifiers with embedded slashes", () => {
    const papers = parseArxivAtom(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v1</id>
    <updated>2026-06-21T12:00:00Z</updated>
    <published>2026-06-21T12:00:00Z</published>
    <title>Legacy identifier</title>
    <summary>Legacy abstract</summary>
    <author><name>Example Author</name></author>
    <category term="hep-th"/>
  </entry>
</feed>`);

    expect(papers[0]?.arxivId).toBe("hep-th/9901001v1");
  });

  it("throws for a missing required field", () => {
    expect(() =>
      parseArxivAtom(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2606.20408v1</id>
    <updated>2026-06-21T12:00:00Z</updated>
    <published>2026-06-21T12:00:00Z</published>
    <summary>Missing title</summary>
    <author><name>Example Author</name></author>
    <category term="cs.AI"/>
  </entry>
</feed>`)
    ).toThrowError("Invalid arXiv entry at index 0: missing title");
  });

  it("throws for an invalid published date", () => {
    expect(() =>
      parseArxivAtom(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2606.20408v1</id>
    <updated>2026-06-21T12:00:00Z</updated>
    <published>not-a-date</published>
    <title>Title</title>
    <summary>Summary</summary>
    <author><name>Example Author</name></author>
    <category term="cs.AI"/>
  </entry>
</feed>`)
    ).toThrowError("Invalid arXiv entry at index 0: invalid published date");
  });
});

describe("fetchArxivPapers", () => {
  it("sends the expected query and parses the response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => arxivAtomFixture
    });
    vi.stubGlobal("fetch", fetchSpy);

    const papers = await fetchArxivPapers("cat:cs.AI", 25);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://export.arxiv.org/api/query?search_query=cat%3Acs.AI&start=0&max_results=25&sortBy=submittedDate&sortOrder=descending",
      {
        headers: {
          "User-Agent": "research-finder/0.1"
        },
        signal: expect.any(AbortSignal)
      }
    );
    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      arxivId: "2606.20408v1",
      title: "LLM agent safety, multi-turn red-teaming, jailbreak benchmarks"
    });
  });

  it("throws on a non-OK response without retrying", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => ""
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchArxivPapers("cat:cs.AI", 10, { retry: { backoffMs: 0 } })).rejects.toThrowError(
      "arXiv fetch failed: 503 Service Unavailable"
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries a transient network failure and then succeeds", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ ok: true, text: async () => arxivAtomFixture });
    vi.stubGlobal("fetch", fetchSpy);

    const papers = await fetchArxivPapers("cat:cs.AI", 10, { retry: { backoffMs: 0 } });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(papers).toHaveLength(1);
  });

  it("throws after exhausting retries on a persistent network failure", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      fetchArxivPapers("cat:cs.AI", 10, { retry: { attempts: 3, backoffMs: 0 } })
    ).rejects.toThrowError("fetch failed");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("aborts a hung request after the timeout and retries", async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          })
      )
      .mockResolvedValueOnce({ ok: true, text: async () => arxivAtomFixture });
    vi.stubGlobal("fetch", fetchSpy);

    const papers = await fetchArxivPapers("cat:cs.AI", 10, {
      retry: { timeoutMs: 5, backoffMs: 0 }
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(papers).toHaveLength(1);
  });
});
