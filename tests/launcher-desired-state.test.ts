import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";
import { getDesiredLanes, setLaneDesired, provisionLaneWorkerToken } from "@/lib/launcher/desired-state";
import { verifyWorkerToken } from "@/lib/jobs/worker-auth";

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

describe("launcher desired state", () => {
  it("defaults to all-off and persists toggles", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "a@example.com" } });
      expect(await getDesiredLanes(u.id)).toEqual({ inbox: false, research: false });
      await setLaneDesired(u.id, "inbox", true);
      expect(await getDesiredLanes(u.id)).toEqual({ inbox: true, research: false });
    });
  });

  it("provisions one launcher-managed worker per lane and rotates its token", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "b@example.com" } });

      const first = await provisionLaneWorkerToken(u.id, "research");
      const second = await provisionLaneWorkerToken(u.id, "research");

      const workers = await db.workerRegistration.findMany({
        where: { userId: u.id, lane: "research", launcherManaged: true }
      });
      expect(workers).toHaveLength(1); // reused, not duplicated
      // token rotated: only the latest verifies
      expect(await verifyWorkerToken(second.token, workers[0].tokenHash)).toBe(true);
      expect(await verifyWorkerToken(first.token, workers[0].tokenHash)).toBe(false);
    });
  });

  it("revokes duplicate launcher-managed workers so only one canonical token verifies", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const u = await db.user.create({ data: { email: "dup@example.com" } });
      // Simulate a transient double-launcher having created two launcher-managed rows.
      await db.workerRegistration.create({
        data: { userId: u.id, lane: "inbox", launcherManaged: true, label: "a", tokenHash: "h1", status: "active" }
      });
      await db.workerRegistration.create({
        data: { userId: u.id, lane: "inbox", launcherManaged: true, label: "b", tokenHash: "h2", status: "active" }
      });

      const { token } = await provisionLaneWorkerToken(u.id, "inbox");

      const active = await db.workerRegistration.findMany({
        where: { userId: u.id, lane: "inbox", launcherManaged: true, status: "active", revokedAt: null }
      });
      expect(active).toHaveLength(1);
      expect(await verifyWorkerToken(token, active[0].tokenHash)).toBe(true);
    });
  });
});
