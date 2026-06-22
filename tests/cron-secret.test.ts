import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "@/app/api/cron/ingest/auth";

describe("isAuthorizedCronRequest", () => {
  it("accepts matching bearer token", () => {
    expect(isAuthorizedCronRequest("Bearer secret", "secret")).toBe(true);
  });

  it("rejects missing or wrong bearer token", () => {
    expect(isAuthorizedCronRequest(null, "secret")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer wrong", "secret")).toBe(false);
  });
});
