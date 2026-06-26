-- Heartbeat for long-running research stage jobs (experiment stage)
ALTER TABLE "ResearchStageJob" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
