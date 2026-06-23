import { describe, expect, it } from "vitest";

import {
  canDispatchIdeaForProfile,
  canEditProfile,
  canViewUserResearch
} from "@/lib/auth/permissions";

describe("v2 permissions", () => {
  it("allows shared viewing between allowed users", () => {
    expect(canViewUserResearch({ currentUserId: "user-1", targetUserId: "user-2" })).toBe(true);
  });

  it("allows editing only the user's own profile", () => {
    expect(canEditProfile({ currentUserId: "user-1", targetUserId: "user-1" })).toBe(true);
    expect(canEditProfile({ currentUserId: "user-1", targetUserId: "user-2" })).toBe(false);
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
