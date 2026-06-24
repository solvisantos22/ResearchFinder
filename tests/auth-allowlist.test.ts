import { describe, expect, it } from "vitest";

import { isAllowedGoogleEmail, parseAllowedGoogleEmails } from "@/lib/auth/allowed-emails";

describe("Google email allowlist", () => {
  it("normalizes configured allowed emails", () => {
    expect(parseAllowedGoogleEmails(" Solvi@Example.com,collab@example.com ")).toEqual([
      "solvi@example.com",
      "collab@example.com"
    ]);
  });

  it("accepts only allowlisted emails", () => {
    expect(isAllowedGoogleEmail("SOLVI@example.com", ["solvi@example.com"])).toBe(true);
    expect(isAllowedGoogleEmail("unknown@example.com", ["solvi@example.com"])).toBe(false);
    expect(isAllowedGoogleEmail(undefined, ["solvi@example.com"])).toBe(false);
  });
});
