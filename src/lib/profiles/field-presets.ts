import { defaultRankingWeights } from "@/lib/domain";

export const fieldPresets = {
  ai_ml: {
    label: "AI / ML",
    keywords: [
      "LLM evaluation",
      "multi-agent systems",
      "benchmark design",
      "agentic research workflows"
    ],
    preferredOutputs: ["benchmark", "evaluation harness", "open-source tool"],
    constraints: [
      "Prefer credible prototypes in 1-3 weeks",
      "Avoid frontier-scale model training"
    ],
    defaultArxivQuery:
      "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND (all:LLM OR all:evaluation OR all:agent OR all:benchmark OR all:reasoning)"
  },
  chemistry: {
    label: "Chemistry",
    keywords: ["catalysis", "materials discovery", "molecular simulation"],
    preferredOutputs: ["simulation", "dataset", "reproducible analysis"],
    constraints: ["Prefer computational or literature-grounded projects first"],
    defaultArxivQuery:
      "(cat:physics.chem-ph OR cat:cond-mat.mtrl-sci OR cat:q-bio.BM) AND (all:catalysis OR all:materials OR all:molecular OR all:synthesis)"
  }
} as const;

export type FieldPresetKey = keyof typeof fieldPresets;

export function isFieldPresetKey(value: string): value is FieldPresetKey {
  return value in fieldPresets;
}

export function buildPresetProfileData(key: FieldPresetKey) {
  const preset = fieldPresets[key];

  return {
    fieldPresetKey: key,
    interestsJson: JSON.stringify(preset.keywords),
    keywordsJson: JSON.stringify(preset.keywords),
    constraintsJson: JSON.stringify(preset.constraints),
    preferredOutputsJson: JSON.stringify(preset.preferredOutputs),
    rankingWeightsJson: JSON.stringify(defaultRankingWeights),
    arxivQuery: preset.defaultArxivQuery,
    maxDailyPapers: 10,
    normalDailyRuntimeMin: 45,
    maxDailyRuntimeMin: 120,
    maxPapersScreened: 40,
    maxPapersDeepRead: 6,
    allowPdfFetch: false,
    allowRelatedWorkSearch: true
  };
}
