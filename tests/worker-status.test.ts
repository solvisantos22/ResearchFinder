import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

afterEach(() => {
  mocked.prisma = null;
});

describe("resolveWorkerStatusForUser", () => {
  it("reports offline when the user has no worker", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "no-worker@example.com" } });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("offline");
    });
  });

  it("reports online when the newest worker was seen recently", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "online@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id,
          label: "Local worker",
          tokenHash: "hash",
          status: "active",
          lastSeenAt: new Date()
        }
      });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("online");
    });
  });

  it("reports needs_auth when the newest worker needs auth", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "auth@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id,
          label: "Local worker",
          tokenHash: "hash",
          status: "needs_auth",
          lastSeenAt: new Date()
        }
      });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("needs_auth");
    });
  });

  it("reports online when seen 90 seconds ago", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "recent@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id,
          label: "Local worker",
          tokenHash: "hash",
          status: "active",
          lastSeenAt: new Date(Date.now() - 90 * 1000)
        }
      });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("online");
    });
  });

  it("reports offline when seen 5 minutes ago", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "lapsed@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id,
          label: "Local worker",
          tokenHash: "hash",
          status: "active",
          lastSeenAt: new Date(Date.now() - 5 * 60 * 1000)
        }
      });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("offline");
    });
  });
});
