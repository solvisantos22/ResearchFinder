import { prisma } from "@/lib/db";
import { createWorkerToken, hashWorkerToken } from "@/lib/jobs/worker-auth";

export async function registerWorkerForUser(input: { userId: string; label: string }) {
  const token = createWorkerToken();
  const tokenHash = await hashWorkerToken(token);

  const worker = await prisma.workerRegistration.create({
    data: {
      userId: input.userId,
      label: input.label,
      tokenHash,
      status: "active"
    },
    select: { id: true }
  });

  return {
    workerId: worker.id,
    token
  };
}
