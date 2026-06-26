import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";
import { registerLauncherForUser } from "@/lib/jobs/launcher-registration";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

afterEach(() => {
  mocked.prisma = null;
  vi.unstubAllEnvs();
});

async function callRoute(lane: string, bearerToken: string) {
  const { POST } = await import(`@/app/api/launcher/workers/[lane]/token/route`);
  return POST(
    new Request(`https://x/api/launcher/workers/${lane}/token`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearerToken}` }
    }),
    { params: Promise.resolve({ lane }) }
  );
}

describe("POST /api/launcher/workers/[lane]/token", () => {
  it("401s without a valid bearer", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "d@example.com");
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const res = await callRoute("inbox", "bad-token");
      expect(res.status).toBe(401);
    });
  });

  it("400 for an invalid lane", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "d@example.com");
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "d@example.com" } });
      const { token } = await registerLauncherForUser({ userId: u.id, label: "L" });

      const resBoth = await callRoute("both", token);
      expect(resBoth.status).toBe(400);

      const resNope = await callRoute("nope", token);
      expect(resNope.status).toBe(400);
    });
  });

  it("returns a token and creates exactly one launcher-managed worker for the lane", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "d@example.com");
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "d@example.com" } });
      const { token } = await registerLauncherForUser({ userId: u.id, label: "L" });

      const res = await callRoute("inbox", token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string };
      expect(typeof body.token).toBe("string");
      expect(body.token.length).toBeGreaterThan(0);

      const workers = await db.workerRegistration.findMany({
        where: { userId: u.id, lane: "inbox", launcherManaged: true }
      });
      expect(workers).toHaveLength(1);
    });
  });

  it("reuses the same worker registration on a second call (no duplicates)", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "d@example.com");
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "d@example.com" } });
      const { token } = await registerLauncherForUser({ userId: u.id, label: "L" });

      await callRoute("research", token);
      await callRoute("research", token);

      const workers = await db.workerRegistration.findMany({
        where: { userId: u.id, lane: "research", launcherManaged: true }
      });
      expect(workers).toHaveLength(1);
    });
  });
});
