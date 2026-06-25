import { describe, expect, it } from "vitest";

import { buildNoveltyQueries } from "@/lib/novelty/query-builder";

describe("novelty query builder", () => {
  it("builds bounded exact and broad queries from idea and source paper context", () => {
    const queries = buildNoveltyQueries({
      ideaTitle: "AutoBenchsmith for Agent Benchmark Item Generation",
      ideaSummary: "Generate benchmark items for agent failure discovery.",
      paperTitle: "Autodata: An agentic data scientist to create high quality synthetic data",
      paperAbstract: "We study agentic synthetic data creation.",
      keywords: ["agent evaluation", "benchmark generation"]
    });

    expect(queries).toEqual([
      "\"AutoBenchsmith\" \"benchmark\"",
      "\"Agent Benchmark Item Generation\"",
      "\"benchmark generation\" \"agent evaluation\"",
      "\"agentic synthetic data\" \"benchmark\"",
      "agent benchmark generation failure discovery"
    ]);
  });

  it("deduplicates and caps queries", () => {
    const queries = buildNoveltyQueries({
      ideaTitle: "OrderRobustEval: Shuffle Invariance Tests",
      ideaSummary: "Shuffle invariance tests for benchmark robustness.",
      paperTitle: "Shuffle Invariance Tests",
      paperAbstract: "Shuffle invariance tests.",
      keywords: ["benchmark robustness", "benchmark robustness"],
      maxQueries: 3
    });

    expect(queries).toHaveLength(3);
    expect(new Set(queries).size).toBe(3);
  });
});
