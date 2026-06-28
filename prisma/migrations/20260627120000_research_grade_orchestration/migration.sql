-- Phase 1 orchestration spine: per-attempt + producer/critic tracking, backtrack supersession, budgets.

-- ResearchProject budget counters (backfills existing rows to 0 via DEFAULT)
ALTER TABLE "ResearchProject" ADD COLUMN "producerRunsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ResearchProject" ADD COLUMN "backtracksUsed" INTEGER NOT NULL DEFAULT 0;

-- ResearchStageJob: distinguish producer vs critic, per-attempt tracking, carried feedback, critic verdict
ALTER TABLE "ResearchStageJob" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'producer';
ALTER TABLE "ResearchStageJob" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ResearchStageJob" ADD COLUMN "feedback" TEXT;
ALTER TABLE "ResearchStageJob" ADD COLUMN "verdictJson" TEXT;

-- A stage now has a producer job AND a critic job (plus re-attempts); drop the one-job-per-stage unique.
DROP INDEX "ResearchStageJob_researchProjectId_stageType_key";

-- ResearchStageArtifact: backtracking supersedes downstream artifacts but keeps history.
ALTER TABLE "ResearchStageArtifact" ADD COLUMN "supersededAt" TIMESTAMP(3);
DROP INDEX "ResearchStageArtifact_researchProjectId_stageType_key";
CREATE INDEX "ResearchStageArtifact_researchProjectId_stageType_idx" ON "ResearchStageArtifact"("researchProjectId", "stageType");
