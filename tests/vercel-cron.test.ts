import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type VercelConfig = {
  crons?: Array<{ path: string; schedule: string }>;
};

const config = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8")
) as VercelConfig;

describe("vercel.json crons", () => {
  it("schedules the nightly candidate fetch at 05:00 UTC", () => {
    const candidateCron = config.crons?.find((cron) => cron.path === "/api/cron/candidates");

    expect(candidateCron).toBeDefined();
    expect(candidateCron?.schedule).toBe("0 5 * * *");
  });
});
