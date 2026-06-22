import { describe, expect, it } from "vitest";

import { createInboxReasoning } from "@/lib/inbox/service";

describe("createInboxReasoning", () => {
  it("explains why a paper is ranked and what dispatch should test", () => {
    const reasoning = createInboxReasoning({
      title: "LLM agent red-teaming benchmark",
      score: {
        overall: 0.82,
        paperQuality: 0.9,
        projectOpportunity: 0.8,
        dispatchLikelihood: 0.7
      },
      ideaTitle: "Build a focused evaluation extension"
    });

    expect(reasoning.whyPaperMatters).toContain("strong paper quality");
    expect(reasoning.smallestSprint).toContain("focused evaluation extension");
  });
});
