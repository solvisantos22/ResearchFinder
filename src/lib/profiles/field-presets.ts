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
  },
  biology: {
    label: "Biology",
    categories: ["q-bio.BM", "q-bio.GN", "q-bio.NC"],
    defaultArxivQuery:
      "(cat:q-bio.BM OR cat:q-bio.GN OR cat:q-bio.NC) AND (all:protein OR all:genomics OR all:sequencing OR all:neural OR all:modeling)",
    interests: [
      "computational biology",
      "genomics",
      "protein structure",
      "systems biology",
      "neuroscience modeling"
    ],
    keywords: [
      "genomics",
      "protein structure prediction",
      "single-cell analysis",
      "systems biology",
      "biological sequence models"
    ],
    constraints: [
      "Prefer methods with public biological datasets",
      "Favor analyses that need no new wet-lab data",
      "Avoid projects requiring proprietary clinical data"
    ],
    preferredOutputs: [
      "analysis pipeline",
      "benchmark",
      "reproducible notebook",
      "open dataset"
    ]
  },
  economics: {
    label: "Economics",
    categories: ["econ.EM", "econ.GN", "q-fin.EC"],
    defaultArxivQuery:
      "(cat:econ.EM OR cat:econ.GN OR cat:q-fin.EC) AND (all:causal OR all:estimation OR all:market OR all:policy OR all:forecasting)",
    interests: [
      "econometrics",
      "causal inference",
      "market design",
      "economic forecasting",
      "policy evaluation"
    ],
    keywords: [
      "causal inference",
      "econometric estimation",
      "market design",
      "economic forecasting",
      "policy evaluation"
    ],
    constraints: [
      "Prefer methods with public economic datasets",
      "Favor reproducible empirical designs",
      "Avoid claims that need proprietary firm data"
    ],
    preferredOutputs: [
      "empirical study",
      "reproducible analysis",
      "open dataset",
      "policy brief"
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
