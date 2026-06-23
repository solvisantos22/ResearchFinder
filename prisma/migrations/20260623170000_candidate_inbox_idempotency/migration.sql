-- Add database-backed idempotency boundaries for candidate and inbox generation jobs.
CREATE UNIQUE INDEX "CandidateBatch_userId_inboxDate_source_key" ON "CandidateBatch"("userId", "inboxDate", "source");

CREATE UNIQUE INDEX "InboxGenerationJob_userId_candidateBatchId_inboxDate_key" ON "InboxGenerationJob"("userId", "candidateBatchId", "inboxDate");
