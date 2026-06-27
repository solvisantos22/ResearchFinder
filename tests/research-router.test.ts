import { describe, expect, it } from "vitest";

import {
  routeAfterCritic,
  MAX_REDOS_PER_STAGE,
  MAX_BACKTRACKS,
  MAX_PRODUCER_RUNS
} from "@/lib/research/router";
import type { CriticVerdict } from "@/lib/v2/schemas";

const project = { producerRunsUsed: 0, backtracksUsed: 0 };

function verdict(partial: Partial<CriticVerdict> & Pick<CriticVerdict, "verdict">): CriticVerdict {
  return {
    researchProjectId: "proj-1",
    stageType: "plan",
    scorecard: [{ criterion: "c", pass: partial.verdict === "PASS", note: "n" }],
    ...partial
  } as CriticVerdict;
}

describe("routeAfterCritic — PASS", () => {
  it("advances to the next producer stage", () => {
    const action = routeAfterCritic(verdict({ verdict: "PASS", stageType: "plan" }), project, { attempt: 1 });
    expect(action).toEqual({ type: "enqueue_producer", stage: "literature", attempt: 1, feedback: null, incrementProducerRuns: true });
  });

  it("PASS on analysis advances to the paper producer", () => {
    const action = routeAfterCritic(verdict({ verdict: "PASS", stageType: "analysis" }), project, { attempt: 1 });
    expect(action).toEqual({ type: "enqueue_producer", stage: "paper", attempt: 1, feedback: null, incrementProducerRuns: true });
  });

  it("PASS on paper (no next stage) terminates paper_ready", () => {
    const action = routeAfterCritic(verdict({ verdict: "PASS", stageType: "paper" }), project, { attempt: 1 });
    expect(action).toEqual({ type: "set_status", status: "paper_ready" });
  });
});

describe("routeAfterCritic — REDO", () => {
  it("re-enqueues the same stage attempt+1 with feedback when under the per-stage cap", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "REDO", stageType: "plan", feedback: "Add seeds." }),
      project,
      { attempt: 1 }
    );
    expect(action).toEqual({ type: "enqueue_producer", stage: "plan", attempt: 2, feedback: "Add seeds.", incrementProducerRuns: true });
  });

  it("at the per-stage REDO cap, escalates by backtracking to the previous stage", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "REDO", stageType: "literature", feedback: "Still thin." }),
      { producerRunsUsed: 5, backtracksUsed: 0 },
      { attempt: MAX_REDOS_PER_STAGE }
    );
    expect(action).toEqual({
      type: "backtrack",
      targetStage: "plan",
      attempt: 1,
      feedback: "Still thin.",
      supersedeAfter: "plan"
    });
  });

  it("at the REDO cap with no previous stage, sets needs_review", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "REDO", stageType: "plan", feedback: "No." }),
      project,
      { attempt: MAX_REDOS_PER_STAGE }
    );
    expect(action).toEqual({ type: "set_status", status: "needs_review" });
  });
});

describe("routeAfterCritic — BACKTRACK", () => {
  it("backtracks to the target stage and supersedes downstream when under caps", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "BACKTRACK", stageType: "experiment", targetStage: "plan", feedback: "Re-scope." }),
      { producerRunsUsed: 4, backtracksUsed: 1 },
      { attempt: 1 }
    );
    expect(action).toEqual({
      type: "backtrack",
      targetStage: "plan",
      attempt: 1,
      feedback: "Re-scope.",
      supersedeAfter: "plan"
    });
  });

  it("sets needs_review when backtracks are exhausted", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "BACKTRACK", stageType: "experiment", targetStage: "plan", feedback: "Re-scope." }),
      { producerRunsUsed: 4, backtracksUsed: MAX_BACKTRACKS },
      { attempt: 1 }
    );
    expect(action).toEqual({ type: "set_status", status: "needs_review" });
  });

  it("sets needs_review when the total producer-run budget is exhausted", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "BACKTRACK", stageType: "experiment", targetStage: "plan", feedback: "Re-scope." }),
      { producerRunsUsed: MAX_PRODUCER_RUNS, backtracksUsed: 0 },
      { attempt: 1 }
    );
    expect(action).toEqual({ type: "set_status", status: "needs_review" });
  });

  it("PASS still terminates even at the producer-run cap (no new run needed)", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "PASS", stageType: "paper" }),
      { producerRunsUsed: MAX_PRODUCER_RUNS, backtracksUsed: MAX_BACKTRACKS },
      { attempt: 1 }
    );
    expect(action).toEqual({ type: "set_status", status: "paper_ready" });
  });
});

describe("budget constants", () => {
  it("matches the spec defaults", () => {
    expect(MAX_REDOS_PER_STAGE).toBe(3);
    expect(MAX_BACKTRACKS).toBe(5);
    expect(MAX_PRODUCER_RUNS).toBe(30);
  });
});
