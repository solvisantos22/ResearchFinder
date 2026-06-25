-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generatedIdeaId" TEXT NOT NULL,
    "sourceViabilityJobId" TEXT,
    "status" TEXT NOT NULL,
    "currentStage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchPlanJob" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "claimedByWorkerId" TEXT,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchPlanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchPlan" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "planJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchProject_userId_status_createdAt_id_idx" ON "ResearchProject"("userId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPlanJob_researchProjectId_key" ON "ResearchPlanJob"("researchProjectId");

-- CreateIndex
CREATE INDEX "ResearchPlanJob_userId_status_createdAt_id_idx" ON "ResearchPlanJob"("userId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ResearchPlanJob_claimedByWorkerId_status_idx" ON "ResearchPlanJob"("claimedByWorkerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPlan_researchProjectId_key" ON "ResearchPlan"("researchProjectId");

-- AddForeignKey
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_generatedIdeaId_fkey" FOREIGN KEY ("generatedIdeaId") REFERENCES "GeneratedIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlanJob" ADD CONSTRAINT "ResearchPlanJob_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlanJob" ADD CONSTRAINT "ResearchPlanJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlan" ADD CONSTRAINT "ResearchPlan_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
