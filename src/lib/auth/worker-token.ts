import { isAllowedGoogleEmail } from "@/lib/auth/allowed-emails";
import { prisma } from "@/lib/db";
import { verifyWorkerToken } from "@/lib/jobs/worker-auth";

export async function findAllowedWorkerByToken(token: string) {
  const workers = await prisma.workerRegistration.findMany({
    where: {
      status: "active",
      revokedAt: null
    },
    select: {
      id: true,
      userId: true,
      lane: true,
      tokenHash: true,
      user: { select: { email: true } }
    }
  });

  for (const worker of workers) {
    if (await verifyWorkerToken(token, worker.tokenHash)) {
      return isAllowedGoogleEmail(worker.user.email)
        ? { id: worker.id, userId: worker.userId, lane: worker.lane }
        : null;
    }
  }

  return null;
}
