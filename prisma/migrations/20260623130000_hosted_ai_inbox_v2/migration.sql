-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interestsJson" TEXT NOT NULL,
    "constraintsJson" TEXT NOT NULL,
    "preferredOutputsJson" TEXT NOT NULL,
    "rankingWeightsJson" TEXT NOT NULL,
    "arxivQuery" TEXT NOT NULL,
    "maxDailyPapers" INTEGER NOT NULL DEFAULT 10,
    "fieldPresetKey" TEXT NOT NULL DEFAULT 'ai_ml',
    "keywordsJson" TEXT NOT NULL DEFAULT '[]',
    "normalDailyRuntimeMin" INTEGER NOT NULL DEFAULT 45,
    "maxDailyRuntimeMin" INTEGER NOT NULL DEFAULT 120,
    "maxPapersScreened" INTEGER NOT NULL DEFAULT 40,
    "maxPapersDeepRead" INTEGER NOT NULL DEFAULT 6,
    "allowPdfFetch" BOOLEAN NOT NULL DEFAULT false,
    "allowRelatedWorkSearch" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL,
    "arxivId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "abstract" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "arxivUpdatedAt" TIMESTAMP(3) NOT NULL,
    "authorsJson" TEXT NOT NULL,
    "categoriesJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "approach" TEXT NOT NULL,
    "risksJson" TEXT NOT NULL,
    "nextStepsJson" TEXT NOT NULL,
    "tagsJson" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "bestIdeaId" TEXT NOT NULL,
    "inboxDate" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "paperQuality" DOUBLE PRECISION NOT NULL,
    "projectOpportunity" DOUBLE PRECISION NOT NULL,
    "dispatchLikelihood" DOUBLE PRECISION NOT NULL,
    "reasoningJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViabilityJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "sprintDepth" TEXT NOT NULL,
    "autonomyLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verdict" TEXT,
    "errorMessage" TEXT,
    "generatedIdeaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViabilityJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllowedEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldPreset" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "arxivCategoriesJson" TEXT NOT NULL,
    "defaultKeywordsJson" TEXT NOT NULL,
    "defaultOutputsJson" TEXT NOT NULL,
    "defaultConstraintsJson" TEXT NOT NULL,
    "defaultArxivQuery" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldPreset_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PaperSource" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inboxDate" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidatePaper" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "arxivId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "abstract" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "authorsJson" TEXT NOT NULL,
    "categoriesJson" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidatePaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxGenerationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateBatchId" TEXT NOT NULL,
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

    CONSTRAINT "InboxGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedIdea" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "inboxGenerationJobId" TEXT,
    "inboxDate" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "expandedExplanation" TEXT NOT NULL,
    "trajectory" TEXT NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "noveltyStatus" TEXT NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL,
    "significanceScore" DOUBLE PRECISION NOT NULL,
    "originalityScore" DOUBLE PRECISION NOT NULL,
    "feasibilityScore" DOUBLE PRECISION NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "scoreExplanationsJson" TEXT NOT NULL,
    "risksJson" TEXT NOT NULL,
    "smallestSprint" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaCitation" (
    "id" TEXT NOT NULL,
    "generatedIdeaId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceId" TEXT,
    "claim" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerRegistration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "WorkerRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerJobLog" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerJobLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "support" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProfile_userId_key" ON "ResearchProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Paper_arxivId_key" ON "Paper"("arxivId");

-- CreateIndex
CREATE INDEX "InboxItem_userId_inboxDate_overallScore_idx" ON "InboxItem"("userId", "inboxDate", "overallScore");

-- CreateIndex
CREATE UNIQUE INDEX "InboxItem_userId_paperId_inboxDate_key" ON "InboxItem"("userId", "paperId", "inboxDate");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedEmail_email_key" ON "AllowedEmail"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PaperSource_type_sourceId_key" ON "PaperSource"("type", "sourceId");

-- CreateIndex
CREATE INDEX "CandidateBatch_userId_inboxDate_idx" ON "CandidateBatch"("userId", "inboxDate");

-- CreateIndex
CREATE UNIQUE INDEX "CandidatePaper_batchId_arxivId_key" ON "CandidatePaper"("batchId", "arxivId");

-- CreateIndex
CREATE INDEX "InboxGenerationJob_userId_inboxDate_status_idx" ON "InboxGenerationJob"("userId", "inboxDate", "status");

-- CreateIndex
CREATE INDEX "GeneratedIdea_userId_inboxDate_overallScore_idx" ON "GeneratedIdea"("userId", "inboxDate", "overallScore");

-- CreateIndex
CREATE INDEX "WorkerRegistration_userId_status_idx" ON "WorkerRegistration"("userId", "status");

-- CreateIndex
CREATE INDEX "WorkerJobLog_jobType_jobId_idx" ON "WorkerJobLog"("jobType", "jobId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProfile" ADD CONSTRAINT "ResearchProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_bestIdeaId_fkey" FOREIGN KEY ("bestIdeaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViabilityJob" ADD CONSTRAINT "ViabilityJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViabilityJob" ADD CONSTRAINT "ViabilityJob_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViabilityJob" ADD CONSTRAINT "ViabilityJob_generatedIdeaId_fkey" FOREIGN KEY ("generatedIdeaId") REFERENCES "GeneratedIdea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ViabilityJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateBatch" ADD CONSTRAINT "CandidateBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePaper" ADD CONSTRAINT "CandidatePaper_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CandidateBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxGenerationJob" ADD CONSTRAINT "InboxGenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxGenerationJob" ADD CONSTRAINT "InboxGenerationJob_candidateBatchId_fkey" FOREIGN KEY ("candidateBatchId") REFERENCES "CandidateBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedIdea" ADD CONSTRAINT "GeneratedIdea_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedIdea" ADD CONSTRAINT "GeneratedIdea_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedIdea" ADD CONSTRAINT "GeneratedIdea_inboxGenerationJobId_fkey" FOREIGN KEY ("inboxGenerationJobId") REFERENCES "InboxGenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaCitation" ADD CONSTRAINT "IdeaCitation_generatedIdeaId_fkey" FOREIGN KEY ("generatedIdeaId") REFERENCES "GeneratedIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerRegistration" ADD CONSTRAINT "WorkerRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerJobLog" ADD CONSTRAINT "WorkerJobLog_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ViabilityJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
