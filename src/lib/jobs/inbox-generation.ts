import { prisma } from "@/lib/db";

export async function createInboxGenerationJob(input: {
  userId: string;
  candidateBatchId: string;
  inboxDate: string;
}) {
  return prisma.$transaction(async (tx) => {
    const candidateBatch = await tx.candidateBatch.findFirst({
      where: {
        id: input.candidateBatchId,
        userId: input.userId,
        inboxDate: input.inboxDate
      },
      select: { completedAt: true, id: true, status: true }
    });

    if (!candidateBatch) {
      throw new Error("Candidate batch does not belong to this user/date");
    }

    if (candidateBatch.status !== "completed" || !candidateBatch.completedAt) {
      throw new Error("Candidate batch is not complete");
    }

    return tx.inboxGenerationJob.upsert({
      where: {
        userId_candidateBatchId_inboxDate: {
          userId: input.userId,
          candidateBatchId: input.candidateBatchId,
          inboxDate: input.inboxDate
        }
      },
      update: {},
      create: {
        userId: input.userId,
        candidateBatchId: input.candidateBatchId,
        inboxDate: input.inboxDate,
        status: "queued",
        inputJson: JSON.stringify({ candidateBatchId: input.candidateBatchId })
      }
    });
  });
}
