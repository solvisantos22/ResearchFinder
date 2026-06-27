import { describe, expect, it } from "vitest";

import { RESEARCH_PROJECT_STATUSES } from "@/lib/v2/domain";
import { stagesAfter, producerJobType, criticJobType } from "@/lib/research/stages";

describe("needs_review status", () => {
  it("is an allowed research project status", () => {
    expect(RESEARCH_PROJECT_STATUSES).toContain("needs_review");
  });
});

describe("stagesAfter", () => {
  it("returns executable stages strictly after the given stage, in order", () => {
    expect(stagesAfter("plan")).toEqual(["literature", "experiment", "analysis", "paper"]);
    expect(stagesAfter("experiment")).toEqual(["analysis", "paper"]);
    expect(stagesAfter("analysis")).toEqual(["paper"]);
    expect(stagesAfter("paper")).toEqual([]);
  });
});

describe("job type helpers", () => {
  it("builds producer and critic worker job type strings", () => {
    expect(producerJobType("plan")).toBe("research_plan");
    expect(criticJobType("plan")).toBe("research_plan_critic");
    expect(criticJobType("analysis")).toBe("research_analysis_critic");
  });
});
