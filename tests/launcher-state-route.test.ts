import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";
import { registerLauncherForUser } from "@/lib/jobs/launcher-registration";
import { setLaneDesired } from "@/lib/launcher/desired-state";
import { requestLauncherRestart } from "@/lib/launcher/restart";

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

describe("GET /api/launcher/state", () => {
  it("401s without a valid bearer", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "c@example.com");
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { GET } = await import("@/app/api/launcher/state/route");
      const res = await GET(new Request("https://x/api/launcher/state", { headers: { authorization: "Bearer nope" } }));
      expect(res.status).toBe(401);
    });
  });

  it("returns desired lanes and updates lastSeenAt", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "c@example.com");
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "c@example.com" } });
      const { launcherId, token } = await registerLauncherForUser({ userId: u.id, label: "L" });
      await setLaneDesired(u.id, "research", true);

      const { GET } = await import("@/app/api/launcher/state/route");
      const res = await GET(new Request("https://x/api/launcher/state", { headers: { authorization: `Bearer ${token}` } }));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ inbox: false, research: true, restartRequested: false });

      const launcher = await db.launcherRegistration.findUniqueOrThrow({ where: { id: launcherId } });
      expect(launcher.lastSeenAt).not.toBeNull();
    });
  });

  it("returns restartRequested true once after a restart is requested, then clears it", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "c@example.com");
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "c@example.com" } });
      const { token } = await registerLauncherForUser({ userId: u.id, label: "L" });
      await requestLauncherRestart(u.id);

      const { GET } = await import("@/app/api/launcher/state/route");
      const first = await GET(
        new Request("https://x/api/launcher/state", { headers: { authorization: `Bearer ${token}` } })
      );
      await expect(first.json()).resolves.toEqual({ inbox: false, research: false, restartRequested: true });

      const second = await GET(
        new Request("https://x/api/launcher/state", { headers: { authorization: `Bearer ${token}` } })
      );
      await expect(second.json()).resolves.toEqual({ inbox: false, research: false, restartRequested: false });
    });
  });
});
