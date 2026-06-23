import { describe, expect, it } from "vitest";

import { buildPresetProfileData, fieldPresets } from "@/lib/profiles/field-presets";

describe("field presets", () => {
  it("includes AI/ML and chemistry arXiv presets", () => {
    expect(fieldPresets.ai_ml.defaultArxivQuery).toContain("cat:cs.AI");
    expect(fieldPresets.chemistry.defaultArxivQuery).toContain("cat:physics.chem-ph");
  });

  it("builds editable profile defaults from a preset", () => {
    const profile = buildPresetProfileData("ai_ml");
    expect(profile.fieldPresetKey).toBe("ai_ml");
    expect(JSON.parse(profile.keywordsJson)).toContain("LLM evaluation");
    expect(profile.maxDailyPapers).toBe(10);
  });
});
