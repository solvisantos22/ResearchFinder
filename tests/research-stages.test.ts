import { describe, expect, it } from "vitest";
import {
  RESEARCH_STAGES,
  EXECUTABLE_STAGES,
  nextExecutableStage,
  STAGE_REGISTRY
} from "@/lib/research/stages";
import { LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";

describe("research stage registry", () => {
  it("lists stages in pipeline order", () => {
    expect(RESEARCH_STAGES).toEqual(["plan", "literature", "experiment", "analysis", "paper"]);
  });

  it("only plan and literature have executors today", () => {
    expect(EXECUTABLE_STAGES).toEqual(["plan", "literature"]);
  });

  it("advances plan -> literature, and literature is terminal-for-now", () => {
    expect(nextExecutableStage("plan")).toBe("literature");
    expect(nextExecutableStage("literature")).toBeNull();
  });

  it("maps each executable stage to its output schema and grounding requirement", () => {
    expect(STAGE_REGISTRY.plan.outputSchema).toBe(ResearchPlanSchema);
    expect(STAGE_REGISTRY.literature.outputSchema).toBe(LiteratureReviewSchema);
    expect(STAGE_REGISTRY.plan.requiresSourcePaperCitation).toBe(true);
    expect(STAGE_REGISTRY.literature.requiresSourcePaperCitation).toBe(true);
  });
});
