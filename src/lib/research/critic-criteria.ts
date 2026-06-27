import { type ExecutableStage } from "@/lib/research/stages";

export type StageCriteria = {
  criteria: string[];
  routingGuidance: string;
};

// Per-stage critic criteria. Authoritative source: the master design spec's
// "Per-stage producers + critic criteria" section. Written for the CURRENT pipeline
// order (plan -> literature -> experiment -> analysis); the literature<->plan reorder
// in Phase 3 will revisit the plan/literature criteria.
export const CRITIC_CRITERIA: Record<ExecutableStage, StageCriteria> = {
  plan: {
    criteria: [
      "Feasibility: every step is genuinely executable here — a Codex agent with web access + local CPU/GPU + PUBLIC data/code. No step requires paid LLM API keys, proprietary data, or hardware we do not have.",
      "Named, real, available datasets/benchmarks: each dataset or benchmark is named and publicly obtainable (a resolvable URL or a well-known public source), not a placeholder or a to-be-fabricated toy.",
      "Rigor: the design specifies baselines, multiple seeds/repetitions, ablations, and a concrete statistical-analysis plan — not a single one-shot run.",
      "Measurable success criteria: quantitative, decidable pass/fail thresholds tied to the stated metrics.",
      "Grounded in the source paper: the plan states a concrete novel contribution relative to the source paper and cites it."
    ],
    routingGuidance:
      "This is the first stage, so there is no upstream stage to return to — every deficiency is a REDO. REDO if the study is infeasible as described, vague, under-powered (missing ablations/seeds/statistics), uses toy or unavailable data, or lacks measurable success criteria."
  },
  literature: {
    criteria: [
      "Real, URL-verifiable sources: related works cite resolvable URLs/DOIs to real papers. Spot-check them with web search; hallucinated or unresolvable citations are disqualifying.",
      "Concrete, real gap: the identified gap is specific and genuinely open, not a vague truism.",
      "Usable resources surfaced: the review inventories publicly available datasets/code/benchmarks relevant to this direction (this feeds experiment feasibility).",
      "Grounded in the source paper: the review positions the work relative to the source paper and cites it."
    ],
    routingGuidance:
      "REDO if citations are hallucinated or unverifiable, the gap is vague, or no usable public resources are surfaced. BACKTRACK to plan only if the survey shows the planned study is fundamentally misframed (root cause is the plan, not the survey)."
  },
  experiment: {
    criteria: [
      "Real data with real provenance: data was obtained from real public sources with traceable provenance (download/build steps and source URLs). Self-reported artifact paths and sizes must look real — a few-hundred-byte fixture, or a name containing '_style_micro', '_toy', '_synthetic', or 'dummy', signals a fabricated stand-in.",
      "Scale and coverage match the plan: all planned conditions, datasets, baselines, and seeds/repetitions were actually run — not a reduced 'smallest credible' subset. Compare against UPSTREAM_plan.json.",
      "Real metrics vs baselines: reported metrics are computed from the runs against the planned baselines, with raw outputs/artifacts saved.",
      "Grounded in the source paper: results are framed against the source paper and cite it."
    ],
    routingGuidance:
      "If the data is fabricated/toy/synthetic, or the study is infeasible as planned, BACKTRACK to plan to re-scope (the root cause is upstream). If the work is real but thin or incomplete (a missing seed or condition), REDO."
  },
  analysis: {
    criteria: [
      "Appropriate, correct statistics: significance tests, effect sizes, confidence intervals, and multiple-comparison corrections appropriate to the design — not just raw means.",
      "Claims supported by the data: every stated finding is backed by the experiment's actual results — cross-check against UPSTREAM_experiment.json. No claim exceeds what the data shows.",
      "Publication-quality figures/tables: reported artifacts are real (sensible sizes/paths) and referenced, with an honest assessment of each success criterion from UPSTREAM_plan.json.",
      "Honest threats + comparison: limitations and comparison to baselines and the literature are stated honestly."
    ],
    routingGuidance:
      "If the data cannot support the claims because the experiment is insufficient, BACKTRACK to experiment. If the statistics, figures, or writing are flawed but the underlying data is adequate, REDO."
  },
  paper: {
    criteria: [
      "Every empirical claim and number traces to an analysis result: cross-check each figure, number, and claim against UPSTREAM_analysis.json (and the analysis/ artifacts). No invented numbers, no claims the analysis does not support.",
      "Every citation is real and verifiable: each reference resolves to a real paper (URL/DOI) — spot-check with web search — and the source paper is cited.",
      "Figures and tables are present and referenced: the artifacts the paper claims exist with sensible sizes and are referenced in the text.",
      "Novelty is explicit relative to the source paper: the paper states a concrete contribution beyond the source paper, not a restatement.",
      "Method is reproducible from the text: a reader could re-run the study from the described method and protocol.",
      "The LaTeX compiles to a PDF: a non-empty compiled PDF exists (compiled is true and a 'pdf' artifact / pdfPath with bytes > 0). If compilation failed, this criterion fails."
    ],
    routingGuidance:
      "This is the strictest gate — default to rejection unless the paper is genuinely submittable. If any empirical claim is unsupported by the analysis (or the data cannot support it), BACKTRACK to analysis. Writing, structure, missing-section, citation-format, or compilation problems that do not need new results are REDO."
  }
};

// Render a stage's criteria into the prompt block the critic receives as `criteria`.
export function renderCriticCriteria(stage: ExecutableStage): string {
  const { criteria, routingGuidance } = CRITIC_CRITERIA[stage];
  const checklist = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return [
    `Evaluate the ${stage} artifact against ALL of the following criteria.`,
    "Return exactly one scorecard entry per criterion (echo the criterion text in `criterion`),",
    "with pass=true only if the criterion is clearly met. You have web access — use it to verify",
    "any external claim or citation. Default to pass=false when genuinely unsure (anti-rubber-stamp).",
    "",
    "Criteria:",
    checklist,
    "",
    "Routing guidance:",
    routingGuidance
  ].join("\n");
}
