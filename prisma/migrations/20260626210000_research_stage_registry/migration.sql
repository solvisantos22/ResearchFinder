-- Generic research stage tables
CREATE TABLE "ResearchStageJob" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "claimedByWorkerId" TEXT,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchStageJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchStageJob_researchProjectId_stageType_key" ON "ResearchStageJob"("researchProjectId", "stageType");
CREATE INDEX "ResearchStageJob_userId_status_createdAt_id_idx" ON "ResearchStageJob"("userId", "status", "createdAt", "id");
CREATE INDEX "ResearchStageJob_claimedByWorkerId_status_idx" ON "ResearchStageJob"("claimedByWorkerId", "status");
ALTER TABLE "ResearchStageJob" ADD CONSTRAINT "ResearchStageJob_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchStageJob" ADD CONSTRAINT "ResearchStageJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ResearchStageArtifact" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "artifactJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchStageArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchStageArtifact_researchProjectId_stageType_key" ON "ResearchStageArtifact"("researchProjectId", "stageType");
ALTER TABLE "ResearchStageArtifact" ADD CONSTRAINT "ResearchStageArtifact_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing plan-stage rows forward as stageType = 'plan'
INSERT INTO "ResearchStageJob" ("id", "researchProjectId", "userId", "stageType", "status", "claimedByWorkerId", "inputJson", "outputJson", "errorMessage", "createdAt", "startedAt", "completedAt", "updatedAt")
SELECT "id", "researchProjectId", "userId", 'plan', "status", "claimedByWorkerId", "inputJson", "outputJson", "errorMessage", "createdAt", "startedAt", "completedAt", "updatedAt"
FROM "ResearchPlanJob";

INSERT INTO "ResearchStageArtifact" ("id", "researchProjectId", "stageType", "artifactJson", "createdAt")
SELECT "id", "researchProjectId", 'plan', "planJson", "createdAt"
FROM "ResearchPlan";

-- Drop the plan-specific tables
DROP TABLE "ResearchPlan";
DROP TABLE "ResearchPlanJob";
