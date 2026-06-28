import { describe, expect, it } from "vitest";
import {
  AUTONOMY_LEVELS,
  SPRINT_DEPTHS,
  clampScore,
  computeOverallScore,
  sprintDepthConfig
} from "@/lib/domain";
import { RESEARCH_PROJECT_STATUSES } from "@/lib/v2/domain";

describe("domain score helpers", () => {
  it("clamps scores into the 0..1 range", () => {
    expect(clampScore(-0.2)).toBe(0);
    expect(clampScore(0.4567)).toBe(0.457);
    expect(clampScore(1.2)).toBe(1);
  });

  it("computes a weighted overall score", () => {
    expect(
      computeOverallScore({
        paperQuality: 0.9,
        projectOpportunity: 0.7,
        dispatchLikelihood: 0.5
      })
    ).toBe(0.72);
  });

  it("defines the dispatch controls required by the spec", () => {
    expect(SPRINT_DEPTHS).toEqual(["fast", "default", "deep"]);
    expect(AUTONOMY_LEVELS).toEqual(["low", "medium", "high"]);
    expect(sprintDepthConfig.default.expectedDuration).toBe("1-3 hours");
  });
});

describe("research project statuses", () => {
  it("includes paper_ready as the new terminal status", () => {
    expect(RESEARCH_PROJECT_STATUSES).toContain("paper_ready");
  });
});
