import { prisma } from "@/lib/db";

export async function createInboxGenerationJob(input: {
  userId: string;
  candidateBatchId: string;
  inboxDate: string;
}) {
  const existing = await prisma.inboxGenerationJob.findFirst({
    where: {
      userId: input.userId,
      inboxDate: input.inboxDate,
      candidateBatchId: input.candidateBatchId
    }
  });

  if (existing) return existing;

  return prisma.inboxGenerationJob.create({
    data: {
      userId: input.userId,
      candidateBatchId: input.candidateBatchId,
      inboxDate: input.inboxDate,
      status: "queued",
      inputJson: JSON.stringify({ candidateBatchId: input.candidateBatchId })
    }
  });
}
