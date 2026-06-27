import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  fetchArxivPapers: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

vi.mock("@/lib/arxiv/client", () => ({
  fetchArxivPapers: mocked.fetchArxivPapers
}));

afterEach(() => {
  mocked.prisma = null;
  vi.clearAllMocks();
});

function paper(arxivId: string) {
  return {
    arxivId,
    title: `Title ${arxivId}`,
    abstract: `Abstract ${arxivId}`,
    url: `https://arxiv.org/abs/${arxivId}`,
    publishedAt: new Date("2026-06-25T00:00:00.000Z"),
    updatedAt: new Date("2026-06-25T00:00:00.000Z"),
    authors: ["A. Author"],
    categories: ["cs.AI"]
  };
}

describe("createArxivCandidateBatchForUser cross-day dedup", () => {
  it("excludes papers the user already saw in an earlier batch", async () => {
    const { createArxivCandidateBatchForUser } = await import("@/lib/sources/arxiv-candidates");

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({
        data: {
          email: "dedup@example.com",
          profile: {
            create: {
              interestsJson: "[]",
              constraintsJson: "[]",
              preferredOutputsJson: "[]",
              rankingWeightsJson: "{}",
              arxivQuery: "cat:cs.AI"
            }
          }
        }
      });

      // Day 1: paper X is seen.
      const day1Batch = await client.candidateBatch.create({
        data: {
          userId: user.id,
          inboxDate: "2026-06-24",
          source: "arxiv",
          query: "cat:cs.AI",
          status: "completed",
          completedAt: new Date()
        }
      });
      await client.candidatePaper.create({
        data: {
          batchId: day1Batch.id,
          arxivId: "2606.0001",
          title: "Title X",
          abstract: "Abstract X",
          url: "https://arxiv.org/abs/2606.0001",
          publishedAt: new Date("2026-06-24T00:00:00.000Z"),
          authorsJson: "[]",
          categoriesJson: "[]",
          rawJson: "{}"
        }
      });

      // Day 2: arXiv returns X (already seen) and Y (new).
      mocked.fetchArxivPapers.mockResolvedValue([paper("2606.0001"), paper("2606.0002")]);

      const day2 = await createArxivCandidateBatchForUser(user.id, "2026-06-25");
      const ids = day2.candidates.map((candidate) => candidate.arxivId).sort();

      expect(ids).toEqual(["2606.0002"]);
    });
  });
});

describe("createArxivCandidateBatchForUser weekend fallback", () => {
  it("surfaces the most recent unseen papers when every new paper is already seen", async () => {
    const { createArxivCandidateBatchForUser } = await import("@/lib/sources/arxiv-candidates");

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({
        data: {
          email: "weekend@example.com",
          profile: {
            create: {
              interestsJson: "[]",
              constraintsJson: "[]",
              preferredOutputsJson: "[]",
              rankingWeightsJson: "{}",
              arxivQuery: "cat:cs.AI",
              maxPapersScreened: 2
            }
          }
        }
      });

      // Earlier batch: the two newest papers are already seen.
      const earlier = await client.candidateBatch.create({
        data: {
          userId: user.id,
          inboxDate: "2026-06-26",
          source: "arxiv",
          query: "cat:cs.AI",
          status: "completed",
          completedAt: new Date()
        }
      });
      await client.candidatePaper.createMany({
        data: ["2606.1001", "2606.1002"].map((arxivId) => ({
          batchId: earlier.id,
          arxivId,
          title: `Title ${arxivId}`,
          abstract: "Abstract",
          url: `https://arxiv.org/abs/${arxivId}`,
          publishedAt: new Date("2026-06-26T00:00:00.000Z"),
          authorsJson: "[]",
          categoriesJson: "[]",
          rawJson: "{}"
        }))
      });

      // The newest window (maxPapersScreened=2) is entirely already-seen; the deeper
      // fallback window also returns older, unseen papers.
      mocked.fetchArxivPapers.mockImplementation(async (_query: string, maxResults: number) =>
        maxResults <= 2
          ? [paper("2606.1001"), paper("2606.1002")]
          : [
              paper("2606.1001"),
              paper("2606.1002"),
              paper("2606.0903"),
              paper("2606.0902"),
              paper("2606.0901")
            ]
      );

      const batch = await createArxivCandidateBatchForUser(user.id, "2026-06-27");
      const ids = batch.candidates.map((candidate) => candidate.arxivId).sort();

      // The two most recent UNSEEN papers, not the empty new-window.
      expect(ids).toEqual(["2606.0902", "2606.0903"]);
    });
  });
});
