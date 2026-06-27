import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";
import { registerLauncherForUser } from "@/lib/jobs/launcher-registration";
import { requestLauncherRestart, consumeLauncherRestart } from "@/lib/launcher/restart";

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
});

describe("launcher restart flag", () => {
  it("requestLauncherRestart sets restartRequestedAt on the user's active launcher", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "restart@example.com" } });
      const { launcherId } = await registerLauncherForUser({ userId: u.id, label: "L" });

      await requestLauncherRestart(u.id);

      const launcher = await db.launcherRegistration.findUniqueOrThrow({ where: { id: launcherId } });
      expect(launcher.restartRequestedAt).not.toBeNull();
    });
  });

  it("consumeLauncherRestart returns true once and clears the flag (false thereafter)", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "consume@example.com" } });
      const { launcherId } = await registerLauncherForUser({ userId: u.id, label: "L" });
      await requestLauncherRestart(u.id);

      await expect(consumeLauncherRestart(launcherId)).resolves.toBe(true);
      await expect(consumeLauncherRestart(launcherId)).resolves.toBe(false);

      const launcher = await db.launcherRegistration.findUniqueOrThrow({ where: { id: launcherId } });
      expect(launcher.restartRequestedAt).toBeNull();
    });
  });

  it("does not flag a revoked launcher", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "revoked@example.com" } });
      const { launcherId } = await registerLauncherForUser({ userId: u.id, label: "L" });
      await db.launcherRegistration.update({
        where: { id: launcherId },
        data: { status: "revoked", revokedAt: new Date() }
      });

      await requestLauncherRestart(u.id);

      const launcher = await db.launcherRegistration.findUniqueOrThrow({ where: { id: launcherId } });
      expect(launcher.restartRequestedAt).toBeNull();
    });
  });
});
