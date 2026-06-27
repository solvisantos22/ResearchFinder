import { describe, expect, it } from "vitest";

import { CriticVerdictSchema } from "@/lib/v2/schemas";
import { parseCriticVerdict } from "@/worker/output-validation";

const base = {
  researchProjectId: "proj-1",
  stageType: "plan",
  scorecard: [{ criterion: "Feasible here", pass: true, note: "Runs with Codex + public data." }]
};

describe("CriticVerdictSchema", () => {
  it("accepts a PASS verdict with no feedback or targetStage", () => {
    expect(CriticVerdictSchema.parse({ ...base, verdict: "PASS" })).toMatchObject({ verdict: "PASS" });
  });

  it("requires feedback when the verdict is REDO", () => {
    expect(CriticVerdictSchema.safeParse({ ...base, verdict: "REDO" }).success).toBe(false);
    expect(
      CriticVerdictSchema.safeParse({ ...base, verdict: "REDO", feedback: "Add seeds + ablations." }).success
    ).toBe(true);
  });

  it("requires both targetStage and feedback when the verdict is BACKTRACK", () => {
    expect(
      CriticVerdictSchema.safeParse({ ...base, verdict: "BACKTRACK", feedback: "Re-scope." }).success
    ).toBe(false);
    expect(
      CriticVerdictSchema.safeParse({ ...base, verdict: "BACKTRACK", targetStage: "plan", feedback: "Re-scope." }).success
    ).toBe(true);
  });

  it("rejects targetStage on a non-BACKTRACK verdict", () => {
    expect(
      CriticVerdictSchema.safeParse({ ...base, verdict: "PASS", targetStage: "plan" }).success
    ).toBe(false);
  });

  it("requires at least one scorecard entry", () => {
    expect(CriticVerdictSchema.safeParse({ ...base, verdict: "PASS", scorecard: [] }).success).toBe(false);
  });

  it("rejects unknown keys and unknown stage values", () => {
    expect(CriticVerdictSchema.safeParse({ ...base, verdict: "PASS", extra: 1 }).success).toBe(false);
    expect(CriticVerdictSchema.safeParse({ ...base, stageType: "nope", verdict: "PASS" }).success).toBe(false);
  });

  it("parseCriticVerdict parses a JSON string", () => {
    const raw = JSON.stringify({ ...base, verdict: "PASS" });
    expect(parseCriticVerdict(raw)).toMatchObject({ verdict: "PASS", stageType: "plan" });
  });
});
