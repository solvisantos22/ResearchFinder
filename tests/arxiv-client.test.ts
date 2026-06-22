import { describe, expect, it } from "vitest";
import { arxivAtomFixture } from "@/lib/arxiv/fixtures";
import { parseArxivAtom } from "@/lib/arxiv/client";

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
});
