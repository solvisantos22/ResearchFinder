import { describe, expect, it } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";

describe("launcher schema", () => {
  it("persists a LauncherRegistration, WorkerLaneDesiredState, and launcher-managed worker", async () => {
    await withPostgresTestDatabase(async (db) => {
      const user = await db.user.create({ data: { email: "launcher@example.com" } });

      const launcher = await db.launcherRegistration.create({
        data: { userId: user.id, label: "ResearchFinder Launcher", tokenHash: "hash", status: "active" }
      });
      expect(launcher.status).toBe("active");
      expect(launcher.lastSeenAt).toBeNull();

      const desired = await db.workerLaneDesiredState.create({
        data: { userId: user.id, inboxEnabled: true }
      });
      expect(desired.inboxEnabled).toBe(true);
      expect(desired.researchEnabled).toBe(false);

      const worker = await db.workerRegistration.create({
        data: { userId: user.id, label: "Launcher Inbox worker", tokenHash: "wh", status: "active", lane: "inbox", launcherManaged: true }
      });
      expect(worker.launcherManaged).toBe(true);
    });
  });
});
