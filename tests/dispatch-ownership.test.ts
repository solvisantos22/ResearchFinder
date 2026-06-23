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

describe("createViabilityJobForCurrentUser", () => {
  it("creates a job for an idea owned by the signed-in user", async () => {
    const { createViabilityJobForCurrentUser } = await serviceModulePromise;
    const prisma = {
      inboxItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "inbox-item-1",
          userId: "user-1"
        })
      },
      viabilityJob: {
        create: vi.fn().mockResolvedValue({
          id: "job-1",
          userId: "user-1",
          ideaId: "idea-1",
          status: "queued"
        })
      }
    };
    mocked.prisma = prisma as unknown as PrismaClient;

    try {
      await expect(
        createViabilityJobForCurrentUser({
          currentUserId: "user-1",
          ideaId: "idea-1",
          sprintDepth: "default",
          autonomyLevel: "medium"
        })
      ).resolves.toMatchObject({
        userId: "user-1",
        ideaId: "idea-1",
        status: "queued"
      });

      expect(prisma.inboxItem.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          bestIdeaId: "idea-1"
        },
        select: { id: true, userId: true }
      });
      expect(prisma.viabilityJob.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          ideaId: "idea-1",
          sprintDepth: "default",
          autonomyLevel: "medium",
          status: "queued"
        }
      });
    } finally {
      mocked.prisma = null;
    }
  });

  it("rejects an idea that is not owned by the signed-in user", async () => {
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
