import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) {
      throw new Error("Test prisma client has not been initialized");
    }

    return mocked.prisma;
  }
}));

const serviceModulePromise = import("@/lib/dispatch/service");

describe("validateDispatchSettings", () => {
  it("accepts valid sprint depth and autonomy settings", async () => {
    const { validateDispatchSettings } = await serviceModulePromise;

    expect(validateDispatchSettings("default", "medium")).toEqual({
      sprintDepth: "default",
      autonomyLevel: "medium"
    });
  });

  it("rejects invalid values", async () => {
    const { validateDispatchSettings } = await serviceModulePromise;

    expect(() => validateDispatchSettings("huge", "medium")).toThrow("Invalid sprint depth");
    expect(() => validateDispatchSettings("fast", "reckless")).toThrow("Invalid autonomy level");
  });

  it("defaults missing dispatch settings", async () => {
    const { validateDispatchSettingsWithDefaults } = await serviceModulePromise;

    expect(validateDispatchSettingsWithDefaults({})).toEqual({
      sprintDepth: "default",
      autonomyLevel: "medium"
    });
  });
});

describe("createViabilityJobForCurrentUser", () => {
  it("creates a queued viability job for an idea in the signed-in user's inbox", async () => {
    const { createViabilityJobForCurrentUser } = await serviceModulePromise;
    const prisma = {
      inboxItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "inbox-item-1", userId: "user-1" })
      },
      viabilityJob: {
        create: vi.fn().mockResolvedValue({
          userId: "user-1",
          ideaId: "idea-1",
          sprintDepth: "default",
          autonomyLevel: "medium",
          status: "queued"
        })
      }
    };
    mocked.prisma = prisma as unknown as PrismaClient;

    try {
      const job = await createViabilityJobForCurrentUser({
        currentUserId: "user-1",
        ideaId: "idea-1",
        sprintDepth: "default",
        autonomyLevel: "medium"
      });

      expect(job).toMatchObject({
        userId: "user-1",
        ideaId: "idea-1",
        sprintDepth: "default",
        autonomyLevel: "medium",
        status: "queued"
      });
    } finally {
      mocked.prisma = null;
    }
  });

  it("rejects an existing idea that is not in the signed-in user's inbox", async () => {
    const { createViabilityJobForCurrentUser } = await serviceModulePromise;
    const prisma = {
      inboxItem: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      viabilityJob: {
        create: vi.fn()
      }
    };
    mocked.prisma = prisma as unknown as PrismaClient;

    try {
      await expect(
        createViabilityJobForCurrentUser({
          currentUserId: "user-1",
          ideaId: "other-user-idea",
          sprintDepth: "default",
          autonomyLevel: "medium"
        })
      ).rejects.toThrow("Idea is not available in this user's inbox");

      expect(prisma.viabilityJob.create).not.toHaveBeenCalled();
    } finally {
      mocked.prisma = null;
    }
  });
});
