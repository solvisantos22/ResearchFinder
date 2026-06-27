import { describe, expect, it } from "vitest";

import { laneClaimsJobType, LANE_JOB_TYPES, WORKER_JOB_TYPES } from "@/lib/workers/lanes";

describe("laneClaimsJobType", () => {
  it("inbox lane claims only inbox_generation and novelty_scan", () => {
    expect(laneClaimsJobType("inbox", "inbox_generation")).toBe(true);
    expect(laneClaimsJobType("inbox", "novelty_scan")).toBe(true);
    expect(laneClaimsJobType("inbox", "viability_check")).toBe(false);
    expect(laneClaimsJobType("inbox", "research_plan")).toBe(false);
  });

  it("research lane claims only viability_check and research_plan", () => {
    expect(laneClaimsJobType("research", "inbox_generation")).toBe(false);
    expect(laneClaimsJobType("research", "novelty_scan")).toBe(false);
    expect(laneClaimsJobType("research", "viability_check")).toBe(true);
    expect(laneClaimsJobType("research", "research_plan")).toBe(true);
  });

  it("both lane claims everything", () => {
    expect(laneClaimsJobType("both", "inbox_generation")).toBe(true);
    expect(laneClaimsJobType("both", "research_plan")).toBe(true);
  });

  it("an unknown/legacy lane value behaves like both", () => {
    expect(laneClaimsJobType("garbage", "inbox_generation")).toBe(true);
    expect(laneClaimsJobType("garbage", "research_plan")).toBe(true);
  });

  it("LANE_JOB_TYPES.both lists all six job types", () => {
    expect([...LANE_JOB_TYPES.both].sort()).toEqual(
      ["inbox_generation", "novelty_scan", "research_experiment", "research_literature", "research_plan", "viability_check"]
    );
  });
});

describe("research_literature lane mapping", () => {
  it("is a known worker job type", () => {
    expect(WORKER_JOB_TYPES).toContain("research_literature");
  });
  it("is claimed by the research and both lanes, not inbox", () => {
    expect(laneClaimsJobType("research", "research_literature")).toBe(true);
    expect(laneClaimsJobType("both", "research_literature")).toBe(true);
    expect(laneClaimsJobType("inbox", "research_literature")).toBe(false);
  });
});

describe("research_experiment lane mapping", () => {
  it("routes research_experiment to the research and both lanes", () => {
    expect(WORKER_JOB_TYPES).toContain("research_experiment");
    expect(laneClaimsJobType("research", "research_experiment")).toBe(true);
    expect(laneClaimsJobType("both", "research_experiment")).toBe(true);
    expect(laneClaimsJobType("inbox", "research_experiment")).toBe(false);
    expect(LANE_JOB_TYPES.research).toContain("research_experiment");
  });
});
