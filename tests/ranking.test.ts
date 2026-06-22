import { describe, expect, it } from "vitest";
import { scorePaperForProfile } from "@/lib/ranking/scoring";
import { generateIdeasForPaper } from "@/lib/ranking/ideaGenerator";

const paper = {
  title: "Evaluating multi-agent LLM systems with benchmark stress tests",
  abstract:
    "We introduce a benchmark for measuring LLM agent failures under realistic reasoning constraints.",
  categories: ["cs.AI", "cs.CL"]
};

const profile = {
  interests: ["LLM evaluation", "multi-agent systems", "benchmark design"],
  preferredOutputs: ["benchmark", "evaluation harness"]
};

describe("ranking", () => {
  it("scores papers with a three-part breakdown and overall score", () => {
    const score = scorePaperForProfile(paper, profile);
    expect(score.overall).toBeGreaterThan(0.5);
    expect(score.paperQuality).toBeGreaterThan(0.5);
    expect(score.projectOpportunity).toBeGreaterThan(0.5);
    expect(score.dispatchLikelihood).toBeGreaterThan(0.5);
  });

  it("generates project ideas with dispatch framing", () => {
    const ideas = generateIdeasForPaper(paper, profile);
    expect(ideas).toHaveLength(3);
    expect(ideas[0].title).toContain("evaluation");
    expect(ideas[0].nextSteps[0]).toContain("minimal");
  });
});
