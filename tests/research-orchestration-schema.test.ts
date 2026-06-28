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

async function seedProject(client: PrismaClient) {
  const user = await client.user.create({ data: { email: `orch-${Math.random()}@example.com` } });
  const paper = await client.paper.create({
    data: {
      arxivId: `2503.${Math.floor(Math.random() * 100000)}`,
      title: "Src",
      abstract: "A",
      url: "https://arxiv.org/abs/2503.00001",
      publishedAt: new Date(),
      arxivUpdatedAt: new Date(),
      authorsJson: "[]",
      categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id, paperId: paper.id, inboxDate: "2026-06-27", title: "T", summary: "S",
      expandedExplanation: "E", trajectory: "Tr", recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8, feasibilityScore: 0.8,
      overallScore: 0.8, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  return { user, project };
}

describe("research orchestration schema (Phase 1)", () => {
  it("defaults the new ResearchProject + ResearchStageJob columns", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, project } = await seedProject(client);
      const fresh = await client.researchProject.findUniqueOrThrow({ where: { id: project.id } });
      expect(fresh.producerRunsUsed).toBe(0);
      expect(fresh.backtracksUsed).toBe(0);

      const job = await client.researchStageJob.create({
        data: {
          researchProjectId: project.id, userId: user.id, stageType: "plan",
          status: "queued", inputJson: "{}"
        }
      });
      expect(job.kind).toBe("producer");
      expect(job.attempt).toBe(1);
      expect(job.feedback).toBeNull();
      expect(job.verdictJson).toBeNull();
    });
  });

  it("allows a producer AND a critic job for the same stage (old unique dropped)", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, project } = await seedProject(client);
      await client.researchStageJob.create({
        data: { researchProjectId: project.id, userId: user.id, stageType: "plan", kind: "producer", status: "completed", inputJson: "{}" }
      });
      await expect(
        client.researchStageJob.create({
          data: { researchProjectId: project.id, userId: user.id, stageType: "plan", kind: "critic", status: "queued", inputJson: "{}" }
        })
      ).resolves.toBeTruthy();
    });
  });

  it("allows multiple artifacts per stage with supersededAt (old unique dropped)", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { project } = await seedProject(client);
      await client.researchStageArtifact.create({
        data: { researchProjectId: project.id, stageType: "plan", artifactJson: "{}", supersededAt: new Date() }
      });
      await expect(
        client.researchStageArtifact.create({
          data: { researchProjectId: project.id, stageType: "plan", artifactJson: "{}" }
        })
      ).resolves.toBeTruthy();
      const live = await client.researchStageArtifact.findMany({
        where: { researchProjectId: project.id, stageType: "plan", supersededAt: null }
      });
      expect(live).toHaveLength(1);
    });
  });
});
