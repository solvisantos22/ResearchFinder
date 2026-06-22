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

    for (const idea of ideas) {
      expect(idea.generatedBy).toBe("heuristic:v1");
      expect(idea.summary).toBeTruthy();
      expect(idea.rationale).toBeTruthy();
      expect(idea.approach).toBeTruthy();
      expect(idea.risks).toHaveLength(2);
      expect(idea.nextSteps).toHaveLength(3);
      expect(idea.tags.length).toBeGreaterThan(0);
    }

    expect(ideas[0].title).toContain("evaluation");
    expect(ideas[0].nextSteps[0]).toContain("minimal");
    expect(ideas[0].tags).toEqual(expect.arrayContaining(["evaluation", "benchmark", "viability"]));
    expect(ideas[1].tags).toEqual(
      expect.arrayContaining(["dataset", "failure analysis", "benchmark design"])
    );
    expect(ideas[2].tags).toEqual(
      expect.arrayContaining(["research agents", "planning", "evaluation"])
    );
  });
});
