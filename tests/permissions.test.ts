import { describe, expect, it } from "vitest";

import { canDispatchIdeaForProfile, canViewUserResearch } from "@/lib/auth/permissions";

describe("v2 permissions", () => {
  it("allows shared viewing between allowed users", () => {
    expect(canViewUserResearch({ currentUserId: "user-1", targetUserId: "user-2" })).toBe(true);
  });

  it("allows dispatch only for own generated idea", () => {
    expect(
      canDispatchIdeaForProfile({
        currentUserId: "user-1",
        generatedForUserId: "user-1"
      })
    ).toBe(true);

    expect(
      canDispatchIdeaForProfile({
        currentUserId: "user-1",
        generatedForUserId: "user-2"
      })
    ).toBe(false);
  });
});
