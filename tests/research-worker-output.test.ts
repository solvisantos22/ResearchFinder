import { describe, expect, it } from "vitest";

import { parseResearchStageOutput } from "@/worker/output-validation";

describe("parseResearchStageOutput", () => {
  it("parses a plan stage output", () => {
    const out = parseResearchStageOutput("plan", JSON.stringify({
      researchProjectId: "p1", relationToSourcePaper: "x", hypotheses: ["h"], experimentalDesign: "d",
      protocolSteps: ["s"], datasets: [], baselines: [], metrics: [], successCriteria: ["c"],
      computeEstimate: "e", risks: [],
      citations: [{ sourceType: "paper", title: "t", url: "https://a/abs/1", sourceId: "1", claim: "c", confidence: 0.9 }]
    }));
    expect(out).toMatchObject({ researchProjectId: "p1" });
  });

  it("parses a literature stage output", () => {
    const out = parseResearchStageOutput("literature", JSON.stringify({
      researchProjectId: "p1", relationToSourcePaper: "x",
      relatedWorks: [{ title: "rw", summary: "s", relationToProposed: "r" }],
      themes: ["t"], gaps: ["g"], positioning: "pos",
      citations: [{ sourceType: "paper", title: "t", url: "https://a/abs/1", sourceId: "1", claim: "c", confidence: 0.9 }]
    }));
    expect(out).toMatchObject({ researchProjectId: "p1" });
  });

  it("throws for an unknown stage", () => {
    expect(() => parseResearchStageOutput("experiment", "{}")).toThrow();
  });
});
