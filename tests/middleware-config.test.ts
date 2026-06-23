import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  default: () => ({ auth: vi.fn() })
}));

import { config } from "@/middleware";

function middlewareMatches(pathname: string) {
  const [matcher] = config.matcher;
  return new RegExp(`^${matcher}$`).test(pathname);
}

describe("middleware matcher", () => {
  it("keeps all API routes in route handlers", () => {
    expect(middlewareMatches("/api")).toBe(false);
    expect(middlewareMatches("/api/auth/session")).toBe(false);
    expect(middlewareMatches("/api/cron/ingest")).toBe(false);
    expect(middlewareMatches("/api/workers/jobs")).toBe(false);
    expect(middlewareMatches("/api/future-route")).toBe(false);
  });

  it("protects app routes", () => {
    expect(middlewareMatches("/inbox/user-1")).toBe(true);
    expect(middlewareMatches("/dispatch/idea-1")).toBe(true);
    expect(middlewareMatches("/jobs/job-1")).toBe(true);
  });
});
