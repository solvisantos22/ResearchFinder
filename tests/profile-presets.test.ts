import { describe, expect, it } from "vitest";

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
    expect(JSON.parse(profile.keywordsJson)).toContain("LLM evaluation");
    expect(profile.maxDailyPapers).toBe(10);
  });
});
