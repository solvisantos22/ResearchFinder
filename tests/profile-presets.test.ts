import { describe, expect, it } from "vitest";

import { defaultRankingWeights } from "@/lib/domain";
import { buildPresetProfileData, fieldPresets } from "@/lib/profiles/field-presets";

describe("field presets", () => {
  it("includes first-class AI/ML and chemistry arXiv category sets", () => {
    expect(fieldPresets.ai_ml.categories).toEqual(["cs.AI", "cs.CL", "cs.LG"]);
    expect(fieldPresets.chemistry.categories).toEqual([
      "physics.chem-ph",
      "cond-mat.mtrl-sci",
      "q-bio.BM"
    ]);

    for (const category of fieldPresets.ai_ml.categories) {
      expect(fieldPresets.ai_ml.defaultArxivQuery).toContain(`cat:${category}`);
    }

    for (const category of fieldPresets.chemistry.categories) {
      expect(fieldPresets.chemistry.defaultArxivQuery).toContain(`cat:${category}`);
    }
  });

  it("builds editable profile defaults from a preset", () => {
    const profile = buildPresetProfileData("ai_ml");

    expect(profile.fieldPresetKey).toBe("ai_ml");
    expect(JSON.parse(profile.interestsJson)).toEqual([
      "LLM evaluation",
      "multi-agent systems",
      "benchmark design",
      "agentic research workflows",
      "reasoning under constraints"
    ]);
    expect(JSON.parse(profile.keywordsJson)).toEqual([
      "LLM evaluation",
      "multi-agent systems",
      "agent benchmarks",
      "reasoning",
      "evaluation harness"
    ]);
    expect(JSON.parse(profile.constraintsJson)).toEqual([
      "Prefer credible prototypes in 1-3 weeks",
      "Prefer projects that can become papers after experiments",
      "Avoid frontier-scale model training"
    ]);
    expect(JSON.parse(profile.preferredOutputsJson)).toEqual([
      "benchmark",
      "evaluation harness",
      "open-source tool",
      "paper with reproducible experiments"
    ]);
    expect(JSON.parse(profile.rankingWeightsJson)).toEqual(defaultRankingWeights);
    expect(profile.arxivQuery).toBe(fieldPresets.ai_ml.defaultArxivQuery);
    expect(profile.maxDailyPapers).toBe(10);
    expect(profile.normalDailyRuntimeMin).toBe(45);
    expect(profile.maxDailyRuntimeMin).toBe(120);
    expect(profile.maxPapersScreened).toBe(40);
    expect(profile.maxPapersDeepRead).toBe(6);
    expect(profile.allowPdfFetch).toBe(false);
    expect(profile.allowRelatedWorkSearch).toBe(true);
  });
});
