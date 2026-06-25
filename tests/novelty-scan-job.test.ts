import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createNoveltyScanJobForInboxGeneration } from "@/lib/jobs/novelty-scan";
import { withPostgresTestDatabase } from "./helpers/postgres";

describe("novelty scan persistence", () => {
  it("creates one novelty scan job for a completed inbox generation job", async () => {
    await withPostgresTestDatabase(async (prisma: PrismaClient) => {
      const user = await prisma.user.create({
        data: {
          email: "researcher@example.com",
          profile: {
            create: {
              interestsJson: "[]",
              constraintsJson: "[]",
              preferredOutputsJson: "[]",
              rankingWeightsJson: "{}",
              arxivQuery: "cat:cs.AI",
              keywordsJson: "[\"agent evaluation\"]"
            }
          }
        }
      });
      const candidateBatch = await prisma.candidateBatch.create({
        data: {
          userId: user.id,
          inboxDate: "2026-06-25",
          source: "arxiv",
          query: "cat:cs.AI",
          status: "completed",
          completedAt: new Date()
        }
      });
      const inboxJob = await prisma.inboxGenerationJob.create({
        data: {
          userId: user.id,
          candidateBatchId: candidateBatch.id,
          inboxDate: "2026-06-25",
          status: "completed",
          inputJson: "{}",
          completedAt: new Date()
        }
      });

      const job = await createNoveltyScanJobForInboxGeneration({
        userId: user.id,
        inboxGenerationJobId: inboxJob.id,
        inboxDate: "2026-06-25"
      });
      const duplicate = await createNoveltyScanJobForInboxGeneration({
        userId: user.id,
        inboxGenerationJobId: inboxJob.id,
        inboxDate: "2026-06-25"
      });

      expect(duplicate.id).toBe(job.id);
      expect(job.status).toBe("queued");
    });
  });
});
