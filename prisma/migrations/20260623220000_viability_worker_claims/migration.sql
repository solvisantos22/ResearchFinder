-- Track which registered worker claimed a v2 viability job before accepting completion.
ALTER TABLE "ViabilityJob" ADD COLUMN "claimedByWorkerId" TEXT;

