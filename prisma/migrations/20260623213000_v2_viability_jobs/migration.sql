-- Allow v2 viability jobs to reference GeneratedIdea without a legacy Idea.
ALTER TABLE "ViabilityJob" ALTER COLUMN "ideaId" DROP NOT NULL;

-- GeneratedIdea-backed viability jobs should be removed with their source idea.
ALTER TABLE "ViabilityJob" DROP CONSTRAINT "ViabilityJob_generatedIdeaId_fkey";
ALTER TABLE "ViabilityJob" ADD CONSTRAINT "ViabilityJob_generatedIdeaId_fkey" FOREIGN KEY ("generatedIdeaId") REFERENCES "GeneratedIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
