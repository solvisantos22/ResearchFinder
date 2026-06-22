import { describe, expect, it } from "vitest";

import { validateDispatchSettings } from "@/lib/dispatch/service";

describe("validateDispatchSettings", () => {
  it("accepts valid sprint depth and autonomy settings", () => {
    expect(validateDispatchSettings("default", "medium")).toEqual({
      sprintDepth: "default",
      autonomyLevel: "medium"
    });
  });

  it("rejects invalid values", () => {
    expect(() => validateDispatchSettings("huge", "medium")).toThrow("Invalid sprint depth");
    expect(() => validateDispatchSettings("fast", "reckless")).toThrow("Invalid autonomy level");
  });
});
