import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";
import { registerLauncher, setLaneDesiredAction, getLauncherOverview } from "@/app/workers/actions";
import { getDesiredLanes } from "@/lib/launcher/desired-state";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  requireCurrentUser: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

vi.mock("@/lib/auth/session", () => ({
  requireCurrentUser: mocked.requireCurrentUser
}));

afterEach(() => {
  mocked.prisma = null;
  mocked.requireCurrentUser.mockReset();
  vi.unstubAllEnvs();
});

describe("launcher actions", () => {
  it("registerLauncher() returns a non-empty token and creates a LauncherRegistration row", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "launcher@example.com" } });
      mocked.requireCurrentUser.mockResolvedValue({ id: u.id });

      const result = await registerLauncher();

      expect(result.token).toBeTruthy();
      expect(typeof result.token).toBe("string");
      expect(result.token.length).toBeGreaterThan(0);

      const row = await db.launcherRegistration.findFirst({ where: { userId: u.id } });
      expect(row).not.toBeNull();
      expect(row!.userId).toBe(u.id);
      expect(row!.label).toBe("ResearchFinder Launcher");
    });
  });

  it("setLaneDesiredAction('inbox', true) persists state and returns { inbox: true, research: false }", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "lanes@example.com" } });
      mocked.requireCurrentUser.mockResolvedValue({ id: u.id });

      const result = await setLaneDesiredAction("inbox", true);
      expect(result).toEqual({ inbox: true, research: false });

      const confirmed = await getDesiredLanes(u.id);
      expect(confirmed).toEqual({ inbox: true, research: false });
    });
  });

  it("getLauncherOverview() returns { status: 'offline', desired: { inbox: false, research: false } } for a fresh user", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "overview@example.com" } });
      mocked.requireCurrentUser.mockResolvedValue({ id: u.id });

      const overview = await getLauncherOverview();
      expect(overview).toEqual({ status: "offline", desired: { inbox: false, research: false } });
    });
  });
});
