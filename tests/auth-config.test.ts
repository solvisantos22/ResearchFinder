import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authConfig } from "@/auth.config";

const authorized = authConfig.callbacks?.authorized;

if (!authorized) {
  throw new Error("Expected authConfig.callbacks.authorized to be configured");
}

describe("auth config authorization", () => {
  const originalAllowedEmails = process.env.ALLOWED_GOOGLE_EMAILS;

  beforeEach(() => {
    process.env.ALLOWED_GOOGLE_EMAILS = "user-1@example.com";
  });

  afterEach(() => {
    process.env.ALLOWED_GOOGLE_EMAILS = originalAllowedEmails;
  });

  it("rejects unauthenticated app requests", async () => {
    expect(
      await authorized({
        auth: null,
        request: new NextRequest("http://localhost/inbox/user-1")
      })
    ).toBe(false);
  });

  it("accepts authenticated app requests", async () => {
    expect(
      await authorized({
        auth: {
          expires: new Date("2026-06-24T00:00:00.000Z").toISOString(),
          user: {
            id: "user-1",
            email: "user-1@example.com"
          }
        },
        request: new NextRequest("http://localhost/inbox/user-1")
      })
    ).toBe(true);
  });

  it("rejects existing sessions whose email is no longer allowlisted", async () => {
    process.env.ALLOWED_GOOGLE_EMAILS = "other@example.com";

    expect(
      await authorized({
        auth: {
          expires: new Date("2026-06-24T00:00:00.000Z").toISOString(),
          user: {
            id: "user-1",
            email: "user-1@example.com"
          }
        },
        request: new NextRequest("http://localhost/inbox/user-1")
      })
    ).toBe(false);
  });
});
