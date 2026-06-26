import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";
import { registerLauncherForUser } from "@/lib/jobs/launcher-registration";
import { findAllowedLauncherByToken } from "@/lib/auth/launcher-token";

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

describe("launcher token auth", () => {
  it("registers a launcher and resolves it by token (allowed email)", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "allowed@example.com,allowed2@example.com");
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const user = await db.user.create({ data: { email: "allowed@example.com" } });
      const { launcherId, token } = await registerLauncherForUser({ userId: user.id, label: "L" });

      const found = await findAllowedLauncherByToken(token);
      expect(found).toEqual({ id: launcherId, userId: user.id });
    });
  });

  it("rejects a revoked launcher and a disallowed email", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "allowed@example.com,allowed2@example.com");
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;

      const blocked = await db.user.create({ data: { email: "blocked@notallowed.com" } });
      const { token: blockedToken } = await registerLauncherForUser({ userId: blocked.id, label: "L" });
      expect(await findAllowedLauncherByToken(blockedToken)).toBeNull();

      const ok = await db.user.create({ data: { email: "allowed2@example.com" } });
      const { launcherId, token } = await registerLauncherForUser({ userId: ok.id, label: "L" });
      await db.launcherRegistration.update({ where: { id: launcherId }, data: { revokedAt: new Date() } });
      expect(await findAllowedLauncherByToken(token)).toBeNull();
    });
  });
});
