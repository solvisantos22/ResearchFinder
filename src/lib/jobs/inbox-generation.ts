import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export async function createInboxGenerationJob(input: {
  userId: string;
  candidateBatchId: string;
  inboxDate: string;
}) {
  try {
    return await prisma.inboxGenerationJob.create({
      data: {
        userId: input.userId,
        candidateBatchId: input.candidateBatchId,
        inboxDate: input.inboxDate,
        status: "queued",
        inputJson: JSON.stringify({ candidateBatchId: input.candidateBatchId })
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    return prisma.inboxGenerationJob.findUniqueOrThrow({
      where: {
        userId_candidateBatchId_inboxDate: {
          userId: input.userId,
          candidateBatchId: input.candidateBatchId,
          inboxDate: input.inboxDate
        }
      }
    });
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
