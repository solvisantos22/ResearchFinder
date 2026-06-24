-- Support worker queue claiming and completion lookups for v2 viability jobs.
CREATE INDEX "ViabilityJob_userId_status_createdAt_id_idx" ON "ViabilityJob"("userId", "status", "createdAt", "id");
CREATE INDEX "ViabilityJob_claimedByWorkerId_status_idx" ON "ViabilityJob"("claimedByWorkerId", "status");
