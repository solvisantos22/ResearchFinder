import { describe, expect, it } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";

describe("research stage schema", () => {
  it("persists a stage job and artifact, one per (project, stageType)", async () => {
    await withPostgresTestDatabase(async (db) => {
      const user = await db.user.create({ data: { email: "stage@example.com" } });
      const paper = await db.paper.create({
        data: {
          arxivId: "2501.10000", title: "P", abstract: "A", url: "https://arxiv.org/abs/2501.10000",
          publishedAt: new Date(), arxivUpdatedAt: new Date(), authorsJson: "[]", categoriesJson: "[]"
        }
      });
      const idea = await db.generatedIdea.create({
        data: {
          userId: user.id, paperId: paper.id, inboxDate: "2026-06-26", title: "I", summary: "S",
          expandedExplanation: "E", trajectory: "T", recommended: true, noveltyStatus: "not_checked",
          relevanceScore: 0.5, significanceScore: 0.5, originalityScore: 0.5, feasibilityScore: 0.5,
          overallScore: 0.5, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "X", generatedBy: "codex"
        }
      });
      const project = await db.researchProject.create({
        data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
      });

      const job = await db.researchStageJob.create({
        data: {
          researchProjectId: project.id, userId: user.id, stageType: "plan",
          status: "queued", inputJson: "{}"
        }
      });
      expect(job.stageType).toBe("plan");

      await db.researchStageArtifact.create({
        data: { researchProjectId: project.id, stageType: "plan", artifactJson: "{}" }
      });

      await expect(
        db.researchStageJob.create({
          data: {
            researchProjectId: project.id, userId: user.id, stageType: "plan",
            status: "queued", inputJson: "{}"
          }
        })
      ).rejects.toThrow();
    });
  });
});
