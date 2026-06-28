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

  it("LANE_JOB_TYPES.both lists all eleven job types", () => {
    expect([...LANE_JOB_TYPES.both].sort()).toEqual(
      [
        "inbox_generation",
        "novelty_scan",
        "research_analysis",
        "research_analysis_critic",
        "research_experiment",
        "research_experiment_critic",
        "research_literature",
        "research_literature_critic",
        "research_paper",
        "research_paper_critic",
        "research_plan",
        "research_plan_critic",
        "viability_check"
      ]
    );
  });

  it("includes the paper producer + critic in the research and both lanes", () => {
    expect(WORKER_JOB_TYPES).toContain("research_paper");
    expect(WORKER_JOB_TYPES).toContain("research_paper_critic");
    expect(laneClaimsJobType("research", "research_paper")).toBe(true);
    expect(laneClaimsJobType("research", "research_paper_critic")).toBe(true);
    expect(laneClaimsJobType("both", "research_paper")).toBe(true);
    expect(laneClaimsJobType("inbox", "research_paper")).toBe(false);
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

describe("research critic lane mapping", () => {
  const criticTypes = [
    "research_plan_critic",
    "research_literature_critic",
    "research_experiment_critic",
    "research_analysis_critic"
  ] as const;

  it("registers each critic job type and routes it to research + both, not inbox", () => {
    for (const type of criticTypes) {
      expect(WORKER_JOB_TYPES).toContain(type);
      expect(LANE_JOB_TYPES.research).toContain(type);
      expect(LANE_JOB_TYPES.both).toContain(type);
      expect(laneClaimsJobType("research", type)).toBe(true);
      expect(laneClaimsJobType("both", type)).toBe(true);
      expect(laneClaimsJobType("inbox", type)).toBe(false);
    }
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

  it("routes research_analysis to the research and both lanes", () => {
    expect(WORKER_JOB_TYPES).toContain("research_analysis");
    expect(laneClaimsJobType("research", "research_analysis")).toBe(true);
    expect(laneClaimsJobType("both", "research_analysis")).toBe(true);
    expect(laneClaimsJobType("inbox", "research_analysis")).toBe(false);
    expect(LANE_JOB_TYPES.research).toContain("research_analysis");
  });
});
