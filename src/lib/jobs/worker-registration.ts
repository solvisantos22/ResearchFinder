import { prisma } from "@/lib/db";
import { createWorkerToken, hashWorkerToken } from "@/lib/jobs/worker-auth";
import type { WorkerLane } from "@/lib/v2/domain";

export async function registerWorkerForUser(input: { userId: string; label: string; lane: WorkerLane }) {
  const token = createWorkerToken();
  const tokenHash = await hashWorkerToken(token);

  const worker = await prisma.workerRegistration.create({
    data: {
      userId: input.userId,
      label: input.label,
      tokenHash,
      status: "active",
      lane: input.lane
    },
    select: { id: true }
  });

  return {
    workerId: worker.id,
    token
  };
}
