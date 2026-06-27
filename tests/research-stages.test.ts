import { describe, expect, it } from "vitest";
import {
  RESEARCH_STAGES,
  EXECUTABLE_STAGES,
  nextExecutableStage,
  stagesBefore,
  STAGE_REGISTRY
} from "@/lib/research/stages";
import { AnalysisResultSchema, LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";

describe("research stage registry", () => {
  it("lists stages in pipeline order", () => {
    expect(RESEARCH_STAGES).toEqual(["plan", "literature", "experiment", "analysis", "paper"]);
  });

  it("lists the executable stages in order", () => {
    expect(EXECUTABLE_STAGES).toEqual(["plan", "literature", "experiment", "analysis"]);
  });

  it("advances plan -> literature", () => {
    expect(nextExecutableStage("plan")).toBe("literature");
  });

  it("includes experiment as an executable stage after literature", () => {
    expect(EXECUTABLE_STAGES).toContain("experiment");
    expect(nextExecutableStage("literature")).toBe("experiment");
    expect(EXECUTABLE_STAGES).toContain("analysis");
    expect(nextExecutableStage("experiment")).toBe("analysis");
    expect(nextExecutableStage("analysis")).toBeNull();
    expect(STAGE_REGISTRY.experiment.requiresSourcePaperCitation).toBe(true);
    expect(STAGE_REGISTRY.analysis.requiresSourcePaperCitation).toBe(true);
  });

  it("maps each executable stage to its output schema and grounding requirement", () => {
    expect(STAGE_REGISTRY.plan.outputSchema).toBe(ResearchPlanSchema);
    expect(STAGE_REGISTRY.literature.outputSchema).toBe(LiteratureReviewSchema);
    expect(STAGE_REGISTRY.plan.requiresSourcePaperCitation).toBe(true);
    expect(STAGE_REGISTRY.literature.requiresSourcePaperCitation).toBe(true);
    expect(STAGE_REGISTRY.analysis.outputSchema).toBe(AnalysisResultSchema);
  });

  it("stagesBefore returns the executable stages strictly before, in order", () => {
    expect(stagesBefore("plan")).toEqual([]);
    expect(stagesBefore("literature")).toEqual(["plan"]);
    expect(stagesBefore("experiment")).toEqual(["plan", "literature"]);
    expect(stagesBefore("analysis")).toEqual(["plan", "literature", "experiment"]);
  });
});
