import { describe, expect, it } from "vitest";

import { parseResearchPlanOutput } from "@/worker/output-validation";

describe("parseResearchPlanOutput", () => {
  it("parses a valid plan JSON string", () => {
    const raw = JSON.stringify({
      researchProjectId: "p1",
      relationToSourcePaper: "Extends it.",
      hypotheses: ["H1"],
      experimentalDesign: "D",
      protocolSteps: ["S1"],
      datasets: ["D1"],
      baselines: ["B1"],
      metrics: ["m"],
      successCriteria: ["beats baseline"],
      computeEstimate: "1 GPU-day",
      risks: ["r"],
      citations: [
        {
          sourceType: "paper",
          url: "https://arxiv.org/abs/2501.00001",
          sourceId: "2501.00001",
          title: "Src",
          claim: "c",
          confidence: 0.9
        }
      ]
    });
    expect(parseResearchPlanOutput(raw).researchProjectId).toBe("p1");
  });

  it("throws on malformed JSON", () => {
    expect(() => parseResearchPlanOutput("not json")).toThrow();
  });
});
