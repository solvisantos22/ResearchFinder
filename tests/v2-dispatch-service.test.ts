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

const serviceModulePromise = import("@/lib/jobs/viability");

describe("createV2ViabilityJob", () => {
  it("allows a user to dispatch their own generated idea", async () => {
    const { createV2ViabilityJob } = await serviceModulePromise;
    const prisma = {
      generatedIdea: {
        findUnique: vi.fn().mockResolvedValue({
          id: "generated-idea-1",
          userId: "user-1"
        })
      },
      viabilityJob: {
        create: vi.fn().mockResolvedValue({
          id: "job-1",
          userId: "user-1",
          ideaId: null,
          generatedIdeaId: "generated-idea-1",
          sprintDepth: "default",
          autonomyLevel: "medium",
          status: "queued"
        })
      }
    };
    mocked.prisma = prisma as unknown as PrismaClient;

    try {
      await expect(
        createV2ViabilityJob({
          currentUserId: "user-1",
          generatedIdeaId: "generated-idea-1"
        })
      ).resolves.toMatchObject({
        userId: "user-1",
        ideaId: null,
        generatedIdeaId: "generated-idea-1",
        sprintDepth: "default",
        autonomyLevel: "medium",
        status: "queued"
      });

      expect(prisma.generatedIdea.findUnique).toHaveBeenCalledWith({
        where: { id: "generated-idea-1" },
        select: { id: true, userId: true }
      });
      expect(prisma.viabilityJob.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          ideaId: null,
          generatedIdeaId: "generated-idea-1",
          sprintDepth: "default",
          autonomyLevel: "medium",
          status: "queued"
        }
      });
    } finally {
      mocked.prisma = null;
    }
  });

  it("rejects another user's generated idea", async () => {
    const { createV2ViabilityJob } = await serviceModulePromise;
    const prisma = {
      generatedIdea: {
        findUnique: vi.fn().mockResolvedValue({
          id: "generated-idea-2",
          userId: "user-2"
        })
      },
      viabilityJob: {
        create: vi.fn()
      }
    };
    mocked.prisma = prisma as unknown as PrismaClient;

    try {
      await expect(
        createV2ViabilityJob({
          currentUserId: "user-1",
          generatedIdeaId: "generated-idea-2",
          sprintDepth: "deep",
          autonomyLevel: "high"
        })
      ).rejects.toThrow("Generated idea is not available for dispatch by this user");

      expect(prisma.viabilityJob.create).not.toHaveBeenCalled();
    } finally {
      mocked.prisma = null;
    }
  });
});
