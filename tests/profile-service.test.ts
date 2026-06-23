import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

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

const servicePromise = import("@/lib/profiles/service");

describe("profile service", () => {
  it("preserves an existing profile when ensuring defaults", async () => {
    const { ensureProfileForUser } = await servicePromise;
    const existingProfile = {
      id: "profile-1",
      userId: "user-1",
      fieldPresetKey: "ai_ml",
      arxivQuery: "custom query",
      interestsJson: JSON.stringify(["custom interest"]),
      keywordsJson: JSON.stringify(["custom keyword"])
    };
    const prisma = {
      researchProfile: {
        upsert: vi.fn().mockResolvedValue(existingProfile)
      }
    };
    mocked.prisma = prisma as unknown as PrismaClient;

    try {
      await expect(ensureProfileForUser("user-1", "chemistry")).resolves.toBe(existingProfile);
      expect(prisma.researchProfile.upsert).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        update: {},
        create: expect.objectContaining({
          userId: "user-1",
          fieldPresetKey: "chemistry"
        })
      });
    } finally {
      mocked.prisma = null;
    }
  });

  it("creates a preset profile for a user", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      try {
        await client.user.create({
          data: {
            id: "user-1",
            email: "user-1@example.com"
          }
        });

        const { ensureProfileForUser } = await servicePromise;
        const profile = await ensureProfileForUser("user-1", "ai_ml");

        expect(profile.userId).toBe("user-1");
        expect(profile.fieldPresetKey).toBe("ai_ml");
        expect(profile.arxivQuery).toContain("cat:cs.AI");
        expect(JSON.parse(profile.keywordsJson)).toContain("LLM evaluation");
      } finally {
        mocked.prisma = null;
      }
    });
  });

  it("updates the signed-in user's own profile", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      try {
        await client.user.create({
          data: {
            id: "user-1",
            email: "user-1@example.com"
          }
        });

        const { ensureProfileForUser, updateOwnProfile } = await servicePromise;
        await ensureProfileForUser("user-1", "ai_ml");

        const profile = await updateOwnProfile({
          currentUserId: "user-1",
          targetUserId: "user-1",
          arxivQuery: "cat:cs.CL AND all:evaluation",
          keywords: ["LLM judges", "benchmark drift"],
          constraints: ["No frontier-scale training"],
          preferredOutputs: ["evaluation harness"]
        });

        expect(profile.arxivQuery).toBe("cat:cs.CL AND all:evaluation");
        expect(JSON.parse(profile.keywordsJson)).toEqual(["LLM judges", "benchmark drift"]);
        expect(JSON.parse(profile.interestsJson)).toEqual(["LLM judges", "benchmark drift"]);
        expect(JSON.parse(profile.constraintsJson)).toEqual(["No frontier-scale training"]);
        expect(JSON.parse(profile.preferredOutputsJson)).toEqual(["evaluation harness"]);
      } finally {
        mocked.prisma = null;
      }
    });
  });

  it("rejects edits to another user's profile", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;

      try {
        await client.user.createMany({
          data: [
            {
              id: "user-1",
              email: "user-1@example.com"
            },
            {
              id: "user-2",
              email: "user-2@example.com"
            }
          ]
        });

        const { ensureProfileForUser, updateOwnProfile } = await servicePromise;
        await ensureProfileForUser("user-2", "chemistry");

        await expect(
          updateOwnProfile({
            currentUserId: "user-1",
            targetUserId: "user-2",
            arxivQuery: "cat:cs.AI",
            keywords: ["stolen edit"],
            constraints: ["none"],
            preferredOutputs: ["notes"]
          })
        ).rejects.toThrow("Cannot edit another user's profile");

        const otherProfile = await client.researchProfile.findUniqueOrThrow({
          where: { userId: "user-2" },
          select: { fieldPresetKey: true, arxivQuery: true, keywordsJson: true }
        });

        expect(otherProfile.fieldPresetKey).toBe("chemistry");
        expect(otherProfile.arxivQuery).toContain("cat:physics.chem-ph");
        expect(JSON.parse(otherProfile.keywordsJson)).not.toContain("stolen edit");
      } finally {
        mocked.prisma = null;
      }
    });
  });
});
