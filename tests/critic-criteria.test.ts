import { describe, expect, it } from "vitest";

import { CRITIC_CRITERIA, renderCriticCriteria } from "@/lib/research/critic-criteria";
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
