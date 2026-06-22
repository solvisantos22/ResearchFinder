import { describe, expect, it } from "vitest";

import { buildViabilityDecision } from "@/lib/viability/service";

describe("buildViabilityDecision", () => {
  it("requires prototype, research, and novelty signals for expand verdict", () => {
    const decision = buildViabilityDecision({
      ideaTitle: "Build a benchmark slice",
      paperTitle: "Agent evaluation benchmark",
      sprintDepth: "default",
      autonomyLevel: "medium"
    });

    expect(decision.verdict).toBe("expand");
    expect(decision.prototypeSignal.status).toBe("pass");
    expect(decision.researchSignal.status).toBe("pass");
    expect(decision.noveltySignal.status).toBe("pass");
    expect(decision.artifacts[0].title).toContain("Viability");
  });
});
