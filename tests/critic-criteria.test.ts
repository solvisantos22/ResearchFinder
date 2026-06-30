import { describe, expect, it } from "vitest";

import {
  ACCEPT_HONEST_PARTIAL_RESULTS,
  CRITIC_CRITERIA,
  renderCriticCriteria
} from "@/lib/research/critic-criteria";
import { EXECUTABLE_STAGES } from "@/lib/research/stages";

describe("CRITIC_CRITERIA registry", () => {
  it("defines criteria + routing guidance for every executable stage", () => {
    for (const stage of EXECUTABLE_STAGES) {
      const entry = CRITIC_CRITERIA[stage];
      expect(entry.criteria.length).toBeGreaterThanOrEqual(3);
      expect(entry.criteria.every((c) => c.trim().length > 0)).toBe(true);
      expect(entry.routingGuidance.trim().length).toBeGreaterThan(0);
    }
  });

  it("encodes the experiment toy-data gate and a backtrack-to-plan route", () => {
    const exp = CRITIC_CRITERIA.experiment;
    const text = [exp.criteria.join(" "), exp.routingGuidance].join(" ").toLowerCase();
    expect(text).toContain("real");
    expect(text).toContain("toy");
    expect(exp.routingGuidance.toLowerCase()).toContain("backtrack to plan");
  });

  it("routes analysis backtracks to the experiment stage", () => {
    expect(CRITIC_CRITERIA.analysis.routingGuidance.toLowerCase()).toContain("backtrack to experiment");
  });

  it("tolerates honest partials at experiment/analysis/paper iff ACCEPT_HONEST_PARTIAL_RESULTS is set", () => {
    // The single switch between "validate the pipeline" mode (accept honest partials)
    // and "publishable results only" mode (reject them). "do not reject" only appears
    // in the lenient routing, so it tracks the flag exactly.
    for (const stage of ["experiment", "analysis", "paper"] as const) {
      const routing = CRITIC_CRITERIA[stage].routingGuidance.toLowerCase();
      expect(routing.includes("do not reject")).toBe(ACCEPT_HONEST_PARTIAL_RESULTS);
    }
  });

  it("makes the plan critic REDO-only (no upstream stage to backtrack to in the current order)", () => {
    expect(CRITIC_CRITERIA.plan.routingGuidance.toLowerCase()).toContain("redo");
    expect(CRITIC_CRITERIA.plan.routingGuidance.toLowerCase()).not.toContain("backtrack to");
  });
});

describe("renderCriticCriteria", () => {
  it("renders a numbered checklist + routing guidance + a per-criterion scorecard instruction", () => {
    const rendered = renderCriticCriteria("experiment");
    for (const c of CRITIC_CRITERIA.experiment.criteria) {
      expect(rendered).toContain(c);
    }
    expect(rendered).toContain(CRITIC_CRITERIA.experiment.routingGuidance);
    expect(rendered).toContain("1.");
    expect(rendered.toLowerCase()).toContain("one scorecard entry per criterion");
  });
});

describe("CRITIC_CRITERIA.paper", () => {
  it("defines the strictest paper gate: claims trace to analysis, PDF compiles, backtrack to analysis", () => {
    const paper = CRITIC_CRITERIA.paper;
    const text = paper.criteria.join(" ").toLowerCase();
    expect(text).toContain("compil");      // "compiles to a PDF"
    expect(text).toContain("citation");
    expect(text).toContain("novelt");
    expect(paper.routingGuidance.toLowerCase()).toContain("backtrack to analysis");
  });
});

describe("CRITIC_CRITERIA scientific-rigor gates (Bucket 1, contribution-type-aware)", () => {
  const criteriaText = (stage: keyof typeof CRITIC_CRITERIA) =>
    CRITIC_CRITERIA[stage].criteria.join(" \n ").toLowerCase();

  it("plan states a general valid-comparison + competence floor with ML-method checks first-class and benchmark checks conditional", () => {
    const t = criteriaText("plan");
    // ML-method contribution checks are first-class, not an afterthought
    expect(t).toContain("tuning budget"); // fair comparison: matched compute/tuning
    expect(t).toContain("leakage"); // no train/test leakage
    expect(t).toContain("ablation"); // ablations isolate the claimed mechanism
    expect(t).toContain("reproduce"); // baselines reproduce known numbers
    // benchmark-specific language survives but is gated on the contribution type
    expect(t).toMatch(/benchmark|dataset/);
    expect(t).toContain("majority-class");
    // a general interpretability/competence floor still exists
    expect(t).toMatch(/floor|competen/);
  });

  it("experiment valid-comparison gate covers benchmark manipulation validity AND method matched-budget/leakage", () => {
    const t = criteriaText("experiment");
    expect(t).toMatch(/gold answer|lure/); // benchmark branch retained
    expect(t).toContain("tuning budget"); // method branch added
    expect(t).toContain("leakage");
    expect(t).toContain("ablation");
  });

  it("analysis requires measurement validity, a non-degenerate effect metric, and a contribution-appropriate competence floor", () => {
    const t = criteriaText("analysis");
    expect(t).toMatch(/adjudicat|parse-method|parser/); // benchmark scoring validity retained
    expect(t).toMatch(/metric leakage|uncontaminated|denominator/); // method measurement validity added
    expect(t).toMatch(/excess|exceed/); // non-degenerate metric (general)
    expect(t).toMatch(/seed-to-seed|variance/); // method version of non-degenerate
    expect(t).toMatch(/crippled|known performance|competen/); // interpretability floor both ways
  });

  it("paper requires a release card for every contribution, with benchmark item-pairs and method reproducibility each conditional", () => {
    const t = criteriaText("paper");
    expect(t).toContain("release card"); // general, unconditional
    expect(t).toMatch(/item-pair|item pair/); // benchmark branch retained
    expect(t).toMatch(/hyperparameter|compute budget|splits/); // method branch added
  });
});
