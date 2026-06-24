import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { encodeJsonField } from "@/lib/seed";
import { buildProfiledUserQuery } from "../scripts/ingest-daily";
import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  fetchPapers: vi.fn(),
  scorePaper: vi.fn(),
  generateIdeas: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) {
      throw new Error("Test prisma client has not been initialized");
    }

    return mocked.prisma;
  }
}));

vi.mock("@/lib/arxiv/client", () => ({
  fetchArxivPapers: (...args: unknown[]) => mocked.fetchPapers(...args)
}));

vi.mock("@/lib/ranking/scoring", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ranking/scoring")>(
    "@/lib/ranking/scoring"
  );

  return {
    ...actual,
    scorePaperForProfile: (...args: unknown[]) => mocked.scorePaper(...args)
  };
});

vi.mock("@/lib/ranking/ideaGenerator", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ranking/ideaGenerator")>(
    "@/lib/ranking/ideaGenerator"
  );

  return {
    ...actual,
    generateIdeasForPaper: (...args: unknown[]) => mocked.generateIdeas(...args)
  };
});

const serviceModulePromise = import("@/lib/inbox/service");

describe("createInboxReasoning", () => {
  it("explains why a paper is ranked and what dispatch should test", async () => {
    const { createInboxReasoning } = await serviceModulePromise;

    const reasoning = createInboxReasoning({
      title: "LLM agent red-teaming benchmark",
      score: {
        overall: 0.82,
        paperQuality: 0.9,
        projectOpportunity: 0.8,
        dispatchLikelihood: 0.7
      },
      ideaTitle: "Build a focused evaluation extension"
    });

    expect(reasoning.whyPaperMatters).toContain("strong paper quality");
    expect(reasoning.smallestSprint).toContain("focused evaluation extension");
  });

  it("uses dispatch likelihood thresholds for suggested depth and autonomy", async () => {
    const { createInboxReasoning } = await serviceModulePromise;

    const dispatchFriendly = createInboxReasoning({
      title: "Dispatch-friendly paper",
      score: {
        overall: 0.85,
        paperQuality: 0.8,
        projectOpportunity: 0.8,
        dispatchLikelihood: 0.76
      },
      ideaTitle: "Evaluate a benchmark extension"
    });

    const borderline = createInboxReasoning({
      title: "Borderline paper",
      score: {
        overall: 0.7,
        paperQuality: 0.8,
        projectOpportunity: 0.7,
        dispatchLikelihood: 0.75
      },
      ideaTitle: "Evaluate a benchmark extension"
    });

    expect(dispatchFriendly.suggestedDepth).toBe("default");
    expect(dispatchFriendly.suggestedAutonomy).toBe("medium");
    expect(borderline.suggestedDepth).toBe("fast");
    expect(borderline.suggestedAutonomy).toBe("low");
  });
});

describe("buildProfiledUserQuery", () => {
  it("only targets users that still have a research profile", () => {
    expect(buildProfiledUserQuery()).toEqual({
      where: { profile: { isNot: null } },
      select: { id: true }
    });
  });
});

describe("daily inbox persistence", () => {
  it(
    "persists only the retained top inbox set and removes stale same-day rows",
    async () => {
      const { buildDailyInboxForUser, getInboxItems } = await serviceModulePromise;

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

          await client.researchProfile.create({
            data: {
              userId: "user-1",
              interestsJson: encodeJsonField(["LLM evaluation"]),
              constraintsJson: encodeJsonField(["Keep it concrete"]),
              preferredOutputsJson: encodeJsonField(["benchmark"]),
              rankingWeightsJson: encodeJsonField({
                paperQuality: 0.35,
                projectOpportunity: 0.4,
                dispatchLikelihood: 0.25
              }),
              arxivQuery: "all:llm",
              maxDailyPapers: 2
            }
          });

          const firstRunPapers = [
            buildPaperInput("paper-a", "Paper A", "2026-06-20T10:00:00.000Z"),
            buildPaperInput("paper-b", "Paper B", "2026-06-21T10:00:00.000Z"),
            buildPaperInput("paper-c", "Paper C", "2026-06-22T10:00:00.000Z")
          ];
          const secondRunPapers = [
            buildPaperInput("paper-b", "Paper B", "2026-06-23T10:00:00.000Z"),
            buildPaperInput("paper-c", "Paper C", "2026-06-24T10:00:00.000Z"),
            buildPaperInput("paper-d", "Paper D", "2026-06-25T10:00:00.000Z")
          ];

          mocked.fetchPapers
            .mockResolvedValueOnce(firstRunPapers)
            .mockResolvedValueOnce(secondRunPapers);

          mocked.scorePaper.mockImplementation((paper: { title: string }) => {
            const scores = {
              "Paper A": 0.95,
              "Paper B": 0.9,
              "Paper C": 0.4,
              "Paper D": 0.99
            } as const;
            const overall = scores[paper.title as keyof typeof scores];

            return {
              overall,
              paperQuality: overall,
              projectOpportunity: overall,
              dispatchLikelihood: overall
            };
          });

          mocked.generateIdeas.mockImplementation((paper: { title: string }) => [
            {
              title: `Best idea for ${paper.title}`,
              summary: `Summary for ${paper.title}`,
              rationale: `Rationale for ${paper.title}`,
              approach: `Approach for ${paper.title}`,
              risks: [`Risk for ${paper.title}`],
              nextSteps: [`Next step for ${paper.title}`],
              tags: [paper.title.toLowerCase()],
              generatedBy: "test"
            }
          ]);

          const firstItems = await buildDailyInboxForUser("user-1", "2026-06-22");

          expect(firstItems).toHaveLength(2);
          expect(firstItems.map((item) => item.paper.arxivId)).toEqual(["paper-a", "paper-b"]);

          const firstDbItems = await client.inboxItem.findMany({
            where: { userId: "user-1", inboxDate: "2026-06-22" },
            orderBy: { overallScore: "desc" },
            include: { paper: true }
          });

          expect(firstDbItems).toHaveLength(2);
          expect(firstDbItems.map((item) => item.paper.arxivId)).toEqual(["paper-a", "paper-b"]);

          const retainedPaper = await client.paper.findUniqueOrThrow({
            where: { arxivId: "paper-a" }
          });

          expect(retainedPaper.arxivUpdatedAt.toISOString()).toBe("2026-06-20T10:00:00.000Z");

          const secondItems = await buildDailyInboxForUser("user-1", "2026-06-22");
          expect(secondItems).toHaveLength(2);
          expect(secondItems.map((item) => item.paper.arxivId)).toEqual(["paper-d", "paper-b"]);

          const finalDbItems = await getInboxItems("user-1", "2026-06-22");
          expect(finalDbItems).toHaveLength(2);
          expect(finalDbItems.map((item) => item.paper.arxivId)).toEqual(["paper-d", "paper-b"]);

          const staleInboxItem = await client.inboxItem.findFirst({
            where: {
              userId: "user-1",
              inboxDate: "2026-06-22",
              paper: { arxivId: "paper-a" }
            }
          });

          expect(staleInboxItem).toBeNull();
        } finally {
          mocked.prisma = null;
        }
      });
    },
    15000
  );

  it(
    "reads the configured inbox size instead of truncating to ten",
    async () => {
      const { getInboxItems } = await serviceModulePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        try {
          await client.user.create({
            data: {
              id: "user-2",
              email: "user-2@example.com",
              name: "User Two"
            }
          });

          await client.researchProfile.create({
            data: {
              userId: "user-2",
              interestsJson: encodeJsonField(["LLM evaluation"]),
              constraintsJson: encodeJsonField(["Keep it concrete"]),
              preferredOutputsJson: encodeJsonField(["benchmark"]),
              rankingWeightsJson: encodeJsonField({
                paperQuality: 0.35,
                projectOpportunity: 0.4,
                dispatchLikelihood: 0.25
              }),
              arxivQuery: "all:llm",
              maxDailyPapers: 12
            }
          });

          for (let index = 0; index < 12; index += 1) {
            const paper = await client.paper.create({
              data: {
                arxivId: `bulk-paper-${index}`,
                title: `Bulk Paper ${index}`,
                abstract: `Abstract ${index}`,
                url: `https://arxiv.org/abs/bulk-paper-${index}`,
                publishedAt: new Date("2026-06-01T00:00:00.000Z"),
                arxivUpdatedAt: new Date("2026-06-01T00:00:00.000Z"),
                authorsJson: encodeJsonField([`Author ${index}`]),
                categoriesJson: encodeJsonField(["cs.AI"])
              }
            });

            const idea = await client.idea.create({
              data: {
                paperId: paper.id,
                title: `Idea ${index}`,
                summary: `Summary ${index}`,
                rationale: `Rationale ${index}`,
                approach: `Approach ${index}`,
                risksJson: encodeJsonField([`Risk ${index}`]),
                nextStepsJson: encodeJsonField([`Step ${index}`]),
                tagsJson: encodeJsonField([`tag-${index}`]),
                generatedBy: "test"
              }
            });

            await client.inboxItem.create({
              data: {
                userId: "user-2",
                paperId: paper.id,
                bestIdeaId: idea.id,
                inboxDate: "2026-06-23",
                overallScore: 1 - index * 0.01,
                paperQuality: 1 - index * 0.01,
                projectOpportunity: 1 - index * 0.01,
                dispatchLikelihood: 1 - index * 0.01,
                reasoningJson: encodeJsonField({
                  whyPaperMatters: "matters",
                  whyIdeaPromising: "promising",
                  whyItMightBeTrap: "trap",
                  smallestSprint: "sprint",
                  suggestedDepth: "fast",
                  suggestedAutonomy: "low"
                })
              }
            });
          }

          const items = await getInboxItems("user-2", "2026-06-23");

          expect(items).toHaveLength(12);
          expect(items.map((item) => item.paper.arxivId)).toEqual([
            "bulk-paper-0",
            "bulk-paper-1",
            "bulk-paper-2",
            "bulk-paper-3",
            "bulk-paper-4",
            "bulk-paper-5",
            "bulk-paper-6",
            "bulk-paper-7",
            "bulk-paper-8",
            "bulk-paper-9",
            "bulk-paper-10",
            "bulk-paper-11"
          ]);
        } finally {
          mocked.prisma = null;
        }
      });
    },
    15000
  );
});

function buildPaperInput(arxivId: string, title: string, updatedAt: string) {
  return {
    arxivId,
    title,
    abstract: `Abstract for ${title}`,
    url: `https://arxiv.org/abs/${arxivId}`,
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date(updatedAt),
    authors: [`Author for ${title}`],
    categories: ["cs.AI"]
  };
}
