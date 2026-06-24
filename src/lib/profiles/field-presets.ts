import { defaultRankingWeights } from "@/lib/domain";

export const fieldPresets = {
  ai_ml: {
    label: "AI/ML",
    categories: ["cs.AI", "cs.CL", "cs.LG"],
    defaultArxivQuery:
      "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND (all:LLM OR all:evaluation OR all:agent OR all:benchmark OR all:reasoning)",
    interests: [
      "LLM evaluation",
      "multi-agent systems",
      "benchmark design",
      "agentic research workflows",
      "reasoning under constraints"
    ],
    keywords: [
      "LLM evaluation",
      "multi-agent systems",
      "agent benchmarks",
      "reasoning",
      "evaluation harness"
    ],
    constraints: [
      "Prefer credible prototypes in 1-3 weeks",
      "Prefer projects that can become papers after experiments",
      "Avoid frontier-scale model training"
    ],
    preferredOutputs: [
      "benchmark",
      "evaluation harness",
      "open-source tool",
      "paper with reproducible experiments"
    ]
  },
  chemistry: {
    label: "Chemistry",
    categories: ["physics.chem-ph", "cond-mat.mtrl-sci", "q-bio.BM"],
    defaultArxivQuery:
      "(cat:physics.chem-ph OR cat:cond-mat.mtrl-sci OR cat:q-bio.BM) AND (all:catalysis OR all:synthesis OR all:materials OR all:molecule OR all:screening)",
    interests: [
      "computational chemistry",
      "materials discovery",
      "molecular screening",
      "biomolecular modeling"
    ],
    keywords: [
      "catalysis",
      "molecular screening",
      "materials discovery",
      "computational chemistry",
      "biomolecular modeling"
    ],
    constraints: [
      "Prefer methods with reproducible datasets",
      "Favor bounded wet-lab follow-up requirements",
      "Avoid projects that require unavailable instrumentation"
    ],
    preferredOutputs: [
      "screening workflow",
      "candidate ranking",
      "reproducible notebook",
      "experimental validation plan"
    ]
  }
} as const;

export type FieldPresetKey = keyof typeof fieldPresets;

export type PresetProfileData = {
  fieldPresetKey: FieldPresetKey;
  interestsJson: string;
  keywordsJson: string;
  constraintsJson: string;
  preferredOutputsJson: string;
  rankingWeightsJson: string;
  arxivQuery: string;
  maxDailyPapers: number;
  normalDailyRuntimeMin: number;
  maxDailyRuntimeMin: number;
  maxPapersScreened: number;
  maxPapersDeepRead: number;
  allowPdfFetch: boolean;
  allowRelatedWorkSearch: boolean;
};

export function isFieldPresetKey(value: string): value is FieldPresetKey {
  return Object.prototype.hasOwnProperty.call(fieldPresets, value);
}

export function buildPresetProfileData(key: FieldPresetKey): PresetProfileData {
  const preset = fieldPresets[key];

  return {
    fieldPresetKey: key,
    interestsJson: JSON.stringify(preset.interests),
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
