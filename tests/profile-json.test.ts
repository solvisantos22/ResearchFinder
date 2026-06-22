import { describe, expect, it } from "vitest";
import { defaultRankingWeights } from "@/lib/domain";
import { buildProfileSeedData, encodeJsonField, parseJsonField } from "@/lib/seed";

describe("profile JSON helpers", () => {
  it("round-trips arrays and objects", () => {
    const values = ["LLM evaluation", "agent workflows"];
    const encoded = encodeJsonField(values);
    expect(parseJsonField<string[]>(encoded)).toEqual(values);

    const weights = { paperQuality: 0.35, projectOpportunity: 0.4 };
    expect(parseJsonField<typeof weights>(encodeJsonField(weights))).toEqual(weights);
  });

  it("builds the full profile seed payload", () => {
    const interests = ["LLM evaluation", "agent workflows"];
    const profile = buildProfileSeedData(interests);

    expect(Object.keys(profile).sort()).toEqual(
      [
        "arxivQuery",
        "constraintsJson",
        "interestsJson",
        "maxDailyPapers",
        "preferredOutputsJson",
        "rankingWeightsJson"
      ].sort()
    );
    expect(parseJsonField<string[]>(profile.interestsJson)).toEqual(interests);
    expect(parseJsonField<string[]>(profile.constraintsJson)).toEqual([
      "Prefer credible prototypes in 1-3 weeks",
      "Prefer projects that can become papers after experiments",
      "Avoid frontier-scale model training"
    ]);
    expect(parseJsonField<string[]>(profile.preferredOutputsJson)).toEqual([
      "benchmark",
      "evaluation harness",
      "open-source tool",
      "paper with reproducible experiments"
    ]);
    expect(parseJsonField(profile.rankingWeightsJson)).toEqual(defaultRankingWeights);
    expect(profile.arxivQuery).toBe(
      "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND (all:LLM OR all:evaluation OR all:agent OR all:benchmark OR all:reasoning)"
    );
    expect(profile.maxDailyPapers).toBe(10);
  });
});
