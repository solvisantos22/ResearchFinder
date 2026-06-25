CREATE TABLE "InboxNoveltyScanJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inboxGenerationJobId" TEXT NOT NULL,
    "inboxDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "claimedByWorkerId" TEXT,
    "errorMessage" TEXT,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxNoveltyScanJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoveltyScan" (
    "id" TEXT NOT NULL,
    "generatedIdeaId" TEXT NOT NULL,
    "inboxNoveltyScanJobId" TEXT,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "overlapExplanation" TEXT NOT NULL,
    "queriesJson" TEXT NOT NULL,
    "adaptersAttemptedJson" TEXT NOT NULL,
    "adaptersFailedJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoveltyScan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoveltyEvidence" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceId" TEXT,
    "claim" TEXT NOT NULL,
    "overlapLevel" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoveltyEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxNoveltyScanJob_userId_inboxGenerationJobId_inboxDate_key"
ON "InboxNoveltyScanJob"("userId", "inboxGenerationJobId", "inboxDate");

CREATE INDEX "InboxNoveltyScanJob_userId_inboxDate_status_idx"
ON "InboxNoveltyScanJob"("userId", "inboxDate", "status");

CREATE INDEX "InboxNoveltyScanJob_claimedByWorkerId_status_idx"
ON "InboxNoveltyScanJob"("claimedByWorkerId", "status");

CREATE INDEX "NoveltyScan_generatedIdeaId_createdAt_idx"
ON "NoveltyScan"("generatedIdeaId", "createdAt");

CREATE INDEX "NoveltyScan_label_idx"
ON "NoveltyScan"("label");

CREATE INDEX "NoveltyEvidence_scanId_idx"
ON "NoveltyEvidence"("scanId");

CREATE INDEX "NoveltyEvidence_sourceType_idx"
ON "NoveltyEvidence"("sourceType");

ALTER TABLE "InboxNoveltyScanJob"
ADD CONSTRAINT "InboxNoveltyScanJob_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboxNoveltyScanJob"
ADD CONSTRAINT "InboxNoveltyScanJob_inboxGenerationJobId_fkey"
FOREIGN KEY ("inboxGenerationJobId") REFERENCES "InboxGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoveltyScan"
ADD CONSTRAINT "NoveltyScan_generatedIdeaId_fkey"
FOREIGN KEY ("generatedIdeaId") REFERENCES "GeneratedIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoveltyScan"
ADD CONSTRAINT "NoveltyScan_inboxNoveltyScanJobId_fkey"
FOREIGN KEY ("inboxNoveltyScanJobId") REFERENCES "InboxNoveltyScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NoveltyEvidence"
ADD CONSTRAINT "NoveltyEvidence_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "NoveltyScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
