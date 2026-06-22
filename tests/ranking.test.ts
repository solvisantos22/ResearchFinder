import { describe, expect, it } from "vitest";
import { scorePaperForProfile } from "@/lib/ranking/scoring";
import { generateIdeasForPaper } from "@/lib/ranking/ideaGenerator";

const favorablePaper = {
  title: "Evaluating multi-agent LLM systems with benchmark stress tests",
  abstract:
    "We introduce a benchmark for measuring LLM agent failures under realistic reasoning constraints.",
  categories: ["cs.AI", "cs.CL"]
};

const dispatchFriendlyPaper = {
  title: "Open-source benchmark evaluation toolkit for agent analysis",
  abstract:
    "We release a tool and simulation pipeline for benchmark analysis, prompt auditing, and evaluation.",
  categories: ["cs.AI"]
};

const dispatchPenaltyPaper = {
  title: "Open-source benchmark evaluation toolkit for agent analysis",
  abstract:
    "We release a tool and simulation pipeline for benchmark analysis, prompt auditing, and evaluation on trillion-token pretrain hardware for clinical review.",
  categories: ["cs.AI"]
};

const relevantProfile = {
  interests: ["LLM evaluation", "multi-agent systems", "benchmark design"],
  preferredOutputs: ["benchmark", "evaluation harness"]
};

const irrelevantProfile = {
  interests: ["symbolic logic"],
  preferredOutputs: ["diagram"]
};

describe("ranking", () => {
  it("scores papers with a three-part breakdown and overall score", () => {
    const score = scorePaperForProfile(favorablePaper, relevantProfile);
    expect(score.overall).toBeGreaterThan(0.5);
    expect(score.paperQuality).toBeGreaterThan(0.5);
    expect(score.projectOpportunity).toBeGreaterThan(0.5);
    expect(score.dispatchLikelihood).toBeGreaterThan(0.5);
  });

  it("returns a higher overall score when custom weights emphasize dispatch likelihood", () => {
    const defaultScore = scorePaperForProfile(dispatchFriendlyPaper, irrelevantProfile);
    const weightedScore = scorePaperForProfile(dispatchFriendlyPaper, {
      ...irrelevantProfile,
      rankingWeights: {
        paperQuality: 0.1,
        projectOpportunity: 0.1,
        dispatchLikelihood: 0.8
      }
    });

    expect(weightedScore.paperQuality).toBe(defaultScore.paperQuality);
    expect(weightedScore.projectOpportunity).toBe(defaultScore.projectOpportunity);
    expect(weightedScore.dispatchLikelihood).toBe(defaultScore.dispatchLikelihood);
    expect(weightedScore.overall).toBeGreaterThan(defaultScore.overall);
  });

  it("scores a poor fit lower than a favorable paper", () => {
    const favorableScore = scorePaperForProfile(favorablePaper, relevantProfile);
    const poorFitScore = scorePaperForProfile(
      {
        title: "Scaling trillion-parameter pretraining on specialized hardware",
        abstract:
          "We study clinical deployment constraints for billion-token pretraining infrastructure.",
        categories: ["cs.LG"]
      },
      irrelevantProfile
    );

    expect(poorFitScore.overall).toBeLessThan(favorableScore.overall);
    expect(poorFitScore.projectOpportunity).toBeLessThan(favorableScore.projectOpportunity);
  });

  it("reduces dispatch likelihood when penalty terms appear", () => {
    const friendlyScore = scorePaperForProfile(dispatchFriendlyPaper, irrelevantProfile);
    const penalizedScore = scorePaperForProfile(dispatchPenaltyPaper, irrelevantProfile);

    expect(penalizedScore.dispatchLikelihood).toBeLessThan(friendlyScore.dispatchLikelihood);
  });

  it("raises project opportunity when the profile is more relevant", () => {
    const relevantScore = scorePaperForProfile(favorablePaper, relevantProfile);
    const irrelevantScore = scorePaperForProfile(favorablePaper, irrelevantProfile);

    expect(relevantScore.projectOpportunity).toBeGreaterThan(irrelevantScore.projectOpportunity);
  });

  it("generates project ideas with dispatch framing", () => {
    const ideas = generateIdeasForPaper(favorablePaper, relevantProfile);

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
