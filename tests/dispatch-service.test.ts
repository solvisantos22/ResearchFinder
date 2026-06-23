import { PrismaClient } from "@prisma/client";
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
});

describe("createViabilityJob", () => {
  it(
    "creates a queued viability job for an idea in the user's inbox",
    async () => {
      const { createViabilityJob } = await serviceModulePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        try {
          const { ideaId } = await createInboxFixture(client, {
            userId: "user-1",
            ideaSuffix: "available"
          });

          const job = await createViabilityJob({
            userId: "user-1",
            ideaId,
            sprintDepth: "default",
            autonomyLevel: "medium"
          });

          expect(job).toMatchObject({
            userId: "user-1",
            ideaId,
            sprintDepth: "default",
            autonomyLevel: "medium",
            status: "queued"
          });
        } finally {
          mocked.prisma = null;
        }
      });
    },
    15000
  );

  it(
    "rejects an existing idea that is not in the user's inbox",
    async () => {
      const { createViabilityJob } = await serviceModulePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        try {
          await client.user.create({
            data: {
              id: "user-1",
              email: "user-1@example.com",
              name: "User One"
            }
          });

          const { ideaId } = await createInboxFixture(client, {
            userId: "user-2",
            ideaSuffix: "other-user"
          });

          await expect(
            createViabilityJob({
              userId: "user-1",
              ideaId,
              sprintDepth: "default",
              autonomyLevel: "medium"
            })
          ).rejects.toThrow("Idea is not available in this user's inbox");

          await expect(client.viabilityJob.count()).resolves.toBe(0);
        } finally {
          mocked.prisma = null;
        }
      });
    },
    15000
  );
});

async function createInboxFixture(
  client: PrismaClient,
  input: {
    userId: string;
    ideaSuffix: string;
  }
): Promise<{ ideaId: string }> {
  const user = await client.user.upsert({
    where: { id: input.userId },
    update: {},
    create: {
      id: input.userId,
      email: `${input.userId}@example.com`,
      name: input.userId
    }
  });

  const paper = await client.paper.create({
    data: {
      arxivId: `paper-${input.ideaSuffix}`,
      title: `Paper ${input.ideaSuffix}`,
      abstract: `Abstract ${input.ideaSuffix}`,
      url: `https://arxiv.org/abs/${input.ideaSuffix}`,
      publishedAt: new Date("2026-06-01T00:00:00.000Z"),
      arxivUpdatedAt: new Date("2026-06-01T00:00:00.000Z"),
      authorsJson: JSON.stringify(["Author"]),
      categoriesJson: JSON.stringify(["cs.AI"])
    }
  });

  const idea = await client.idea.create({
    data: {
      paperId: paper.id,
      title: `Idea ${input.ideaSuffix}`,
      summary: `Summary ${input.ideaSuffix}`,
      rationale: `Rationale ${input.ideaSuffix}`,
      approach: `Approach ${input.ideaSuffix}`,
      risksJson: JSON.stringify(["Risk"]),
      nextStepsJson: JSON.stringify(["Step"]),
      tagsJson: JSON.stringify(["tag"]),
      generatedBy: "test"
    }
  });

  await client.inboxItem.create({
    data: {
      userId: user.id,
      paperId: paper.id,
      bestIdeaId: idea.id,
      inboxDate: "2026-06-22",
      overallScore: 0.9,
      paperQuality: 0.9,
      projectOpportunity: 0.9,
      dispatchLikelihood: 0.9,
      reasoningJson: JSON.stringify({
        whyPaperMatters: "matters",
        whyIdeaPromising: "promising",
        whyItMightBeTrap: "trap",
        smallestSprint: "sprint",
        suggestedDepth: "default",
        suggestedAutonomy: "medium"
      })
    }
  });

  return { ideaId: idea.id };
}
