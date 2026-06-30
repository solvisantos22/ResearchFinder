import { type ExecutableStage } from "@/lib/research/stages";

export type StageCriteria = {
  criteria: string[];
  routingGuidance: string;
};

// TEMPORARY — validation mode. While true, the experiment/analysis/paper critics
// accept a rigorous, HONESTLY-reported partial/null/negative result (incompleteness
// truthfully attributed to a documented feasibility limit), so the pipeline can be
// validated end-to-end — including the paper stage — on hardware where the full
// study is infeasible. The no-toy/no-fabrication/rigor/honesty/compile gates stay
// strict regardless.
//
// FLIP TO false (and redeploy) once the paper stage is validated, to require
// COMPLETE, genuinely publishable results — rejecting honest partials. This is the
// single switch between "validate the pipeline" mode and "publishable results" mode.
export const ACCEPT_HONEST_PARTIAL_RESULTS = true;

const experimentCompletenessCriterion = ACCEPT_HONEST_PARTIAL_RESULTS
  ? "Honest about completeness: a genuine, rigorous attempt was made, and any incompleteness is truthfully reported (verdict 'partial'/'failed') with a real explanation — e.g. a documented compute/runtime feasibility limit — never disguised as complete and never patched with fabricated data. A rigorous, honestly-reported PARTIAL or NEGATIVE result is acceptable; full completion is expected only when genuinely feasible on the available hardware."
  : "Scale and coverage match the plan: ALL planned conditions, datasets, baselines, and seeds/repetitions were actually run — not a reduced subset (compare against UPSTREAM_plan.json). An incomplete or merely 'partial' run is NOT acceptable.";

const experimentRouting = ACCEPT_HONEST_PARTIAL_RESULTS
  ? "PASS if the work is real, rigorous, and honest — INCLUDING a partial, null, or negative result whose incompleteness is truthfully attributed to a genuine feasibility limit (do NOT reject merely because hypotheses were inconclusive or the full grid did not finish). BACKTRACK to plan only if the data is fabricated/toy/synthetic or the study is fundamentally misframed (root cause upstream). REDO only for a cheaply-fixable problem needing NO additional compute (e.g. a mislabeled metric or an unsaved artifact); never REDO an honest partial just to demand a run the hardware cannot perform."
  : "If the data is fabricated/toy/synthetic, or the study is infeasible as planned, BACKTRACK to plan to re-scope (root cause upstream). If the work is real but incomplete — a missing seed, condition, or an unfinished grid — REDO until the full planned study completes; an incomplete or merely 'partial' result does NOT pass.";

const analysisRouting = ACCEPT_HONEST_PARTIAL_RESULTS
  ? "PASS if the analysis is statistically sound and its claims match the data — INCLUDING when the honest conclusion is partial, null, or inconclusive (do NOT reject for a negative finding). BACKTRACK to experiment only if the experiment data is fabricated/toy or the analysis cannot proceed at all — NOT merely because results are partial/inconclusive due to a documented feasibility limit. REDO if the statistics, figures, or writing are flawed but the underlying data is adequate (no new compute needed)."
  : "If the data cannot support publication-grade conclusions because the experiment is insufficient, incomplete, or only partial, BACKTRACK to experiment. If the statistics, figures, or writing are flawed but the underlying data is adequate, REDO.";

const paperRouting = ACCEPT_HONEST_PARTIAL_RESULTS
  ? "This is the strictest gate on WRITING, RIGOR, HONESTY, and COMPILATION — default to rejection unless the paper is genuinely well-structured and submittable. A paper that honestly reports PARTIAL, NEGATIVE, or INCONCLUSIVE results — clearly framing them and the feasibility limits — IS acceptable; do NOT reject solely because the findings are inconclusive. BACKTRACK to analysis only if an empirical claim is unsupported or overstated relative to the analysis (a rigor/honesty failure), not because the results themselves are negative. Writing, structure, missing-section, citation-format, or compilation problems that need no new results are REDO."
  : "This is the strictest gate — default to rejection unless the paper is genuinely submittable with COMPLETE, publication-grade results. If any empirical claim is unsupported by the analysis, or the results are merely partial/inconclusive rather than a complete finding, BACKTRACK to analysis (or further upstream). Writing, structure, missing-section, citation-format, or compilation problems that need no new results are REDO.";

// Per-stage critic criteria. Authoritative source: the master design spec's
// "Per-stage producers + critic criteria" section. Written for the CURRENT pipeline
// order (plan -> literature -> experiment -> analysis); the literature<->plan reorder
// in Phase 3 will revisit the plan/literature criteria.
export const CRITIC_CRITERIA: Record<ExecutableStage, StageCriteria> = {
  plan: {
    criteria: [
      "Feasibility: every step is genuinely executable here — a Codex agent with web access + local CPU/GPU + PUBLIC data/code. No step requires paid LLM API keys, proprietary data, or hardware we do not have.",
      "Named, real, available datasets/benchmarks: each dataset or benchmark is named and publicly obtainable (a resolvable URL or a well-known public source), not a placeholder or a to-be-fabricated toy.",
      "Rigor: the design specifies baselines, multiple seeds/repetitions, ablations, and a concrete statistical-analysis plan that names the primary estimand, the unit of analysis and dependency structure (item/model/seed/family), a power or minimum-detectable-effect analysis, and a hierarchical/clustered model — not a single one-shot run or bare means.",
      "Measurable success criteria: quantitative, decidable pass/fail thresholds tied to the stated metrics — not only a headline effect threshold. For a new benchmark/dataset contribution these include manipulation-validity and task-competence thresholds; for a method/model/algorithm contribution they include the fair-comparison conditions and the baseline numbers the method must beat.",
      "Valid-comparison / internal-validity protocol (matched to the contribution type): the plan specifies, BEFORE the full run, how it rules out the most likely confound. For a benchmark/dataset contribution: gold-answer preservation across control/conflict surfaces, conflict-surface lure salience, control-surface absence of the same lure cue, per-group answer/lure label balance, and representative item-pair examples per family. For a method/model/algorithm contribution: matched training data, compute, and hyperparameter-tuning budget across all arms; no train/test or pretraining leakage into the evaluation; baselines configured to reproduce their known published numbers; and ablations that isolate the specific mechanism the gain is attributed to.",
      "Interpretability / competence floor (matched to the contribution type): the plan preregisters a floor that must be cleared before the headline effect is interpreted. For a benchmark/dataset, the evaluated (or a declared anchor) model must exceed BOTH random-choice and majority-class baselines on the control condition by a preregistered margin; for a method/model, the baseline arms must be competent — reproducing their known performance rather than crippled — so a gain cannot be an artifact of a weak baseline. If the floor fails, the study reports a construction/feasibility result, not the headline claim.",
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
      "Real data with real provenance: data was obtained from real public sources with traceable provenance (download/build steps and source URLs). Self-reported artifact paths and sizes must look real — a few-hundred-byte fixture, or a name containing '_style_micro', '_toy', '_synthetic', or 'dummy', signals a fabricated stand-in and is disqualifying.",
      "Genuine, rigorous attempt at the planned study: the harness implements the planned conditions, datasets, baselines, and seeds from UPSTREAM_plan.json, and real runs were actually executed — not a convenience shortcut that skips the hard parts.",
      "Valid comparison / internal validity (matched to the contribution type): the executed study rules out the most likely confound and saves the supporting artifact. For a benchmark/dataset contribution (paired prompts, transformed items, lures, or annotations): item-level validation proving control and conflict surfaces preserve the gold answer, conflict surfaces cue the preregistered lure, controls do not already cue the same lure, and answer/lure labels are balanced within family — spot-check at least 10 random item pairs. For a method/model/algorithm contribution: evidence that arms were matched on training data, compute, and hyperparameter-tuning budget; that there is no train/test or pretraining leakage into the evaluation; that baselines reproduce their known numbers; and ablations that isolate the claimed mechanism. Fail if the relevant confound control is ambiguous, degenerate, or merely asserted.",
      "Real metrics vs baselines: every reported metric is computed from runs that actually executed against the planned baselines, with raw outputs/artifacts saved. No metric is invented, extrapolated, or back-filled.",
      experimentCompletenessCriterion,
      "Grounded in the source paper: results are framed against the source paper and cite it."
    ],
    routingGuidance: experimentRouting
  },
  analysis: {
    criteria: [
      "Design-faithful, correct statistics: significance tests, effect sizes, confidence intervals, and multiple-comparison corrections appropriate to the design — not bare means. The analysis must identify the primary estimand and handle item/model/seed/family/prompt-style dependence (e.g. a hierarchical or clustered/GEE model with item clustering), and report power or minimum-detectable-effect / sensitivity to sample size. Reporting an effect as null/inconclusive with proper uncertainty is correct statistics.",
      "Measurement validity (matched to the contribution type): before hypothesis testing, the primary measurement is validated. For a scored/parsed benchmark: audit the parser/scorer against the raw outputs — parse-method distribution, invalid/unmatched rates, row-level changes vs upstream scoring, and an independent adjudication sample stratified across gold-correct, lure-error, non-lure-wrong, unmatched-text, and parser-changed rows. For a method/model contribution: confirm the metric is computed on the correct, uncontaminated split with the right denominator and protocol and no metric leakage. If plausible measurement error could move any headline result by more than ~2 percentage points, mark the affected claims inconclusive.",
      "Non-degenerate effect metric: a claimed effect is reported as an EXCESS over the appropriate base rate, never a quantity that is mechanically guaranteed. For a lure-error / strategy-misselection claim, lure selection must EXCEED the matched-control and chance wrong-answer base rates (binary/two-choice families where 'lure among incorrect' is mechanically just 'wrong answer' are excluded from the confirmatory claim or analyzed separately). For a method gain, the improvement must exceed seed-to-seed variance against a competently-tuned baseline, not a single lucky run.",
      "Claims supported AND interpretable: every stated finding is backed by the experiment's actual results (cross-check UPSTREAM_experiment.json) and no claim exceeds the data. The contribution's interpretability floor must hold: for a benchmark, if control-surface task competence is at or below random-choice/majority-class baselines, reject any strategy-level interpretation and limit the framing to benchmark-construction / model-incompetence; for a method, if a baseline arm is crippled or below its known performance, reject any 'our method wins' interpretation until a competent baseline is restored.",
      "Publication-quality figures/tables: reported artifacts are real (sensible sizes/paths) and referenced, with an honest assessment of each success criterion from UPSTREAM_plan.json (including criteria not met or not evaluable).",
      "Honest threats + comparison: limitations and comparison to baselines and the literature are stated honestly."
    ],
    routingGuidance: analysisRouting
  },
  paper: {
    criteria: [
      "Every empirical claim and number traces to an analysis result: cross-check each figure, number, and claim against UPSTREAM_analysis.json (and the analysis/ artifacts). No invented numbers, no claims the analysis does not support, and no overstating of partial/negative results.",
      "Every citation is real and verifiable: each reference resolves to a real paper (URL/DOI) — spot-check with web search — and the source paper is cited.",
      "Figures and tables are present and referenced: the artifacts the paper claims exist with sensible sizes and are referenced in the text.",
      "Novelty is explicit relative to the source paper: the paper states a concrete contribution beyond the source paper (the method, harness, or audit protocol counts), not a restatement.",
      "Method is reproducible AND auditable from the text: a reader could re-run the study AND inspect whether the central comparison is valid — path-heavy artifact references alone are NOT sufficient. Every contribution includes an artifact/release card stating exactly what is released and how to reproduce the headline numbers. For a benchmark/dataset contribution, ALSO include representative control/conflict item-pair examples per family (with gold and lure), a qualitative error table with real model outputs (correct, lure-error, non-lure-wrong, parser-failure), and a benchmark-validation summary (semantic-equivalence, lure-salience, label-balance, scoring-adjudication). For a method/model/algorithm contribution, ALSO report the exact training data, splits, compute budget, and full hyperparameters for every arm, evidence of no train/test leakage, baseline numbers shown to match known results, and the ablations isolating the claimed mechanism.",
      "The LaTeX compiles to a PDF: a non-empty compiled PDF exists (compiled is true and a 'pdf' artifact / pdfPath with bytes > 0). If compilation failed, this criterion fails."
    ],
    routingGuidance: paperRouting
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
