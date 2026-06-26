import type { WorkerStatus } from "@/components/WorkerStatusPanel";
import { prisma } from "@/lib/db";

export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export async function resolveWorkerStatusForUser(userId: string): Promise<WorkerStatus> {
  const worker = await prisma.workerRegistration.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { status: true, lastSeenAt: true }
  });

  if (!worker) return "offline";
  if (worker.status === "needs_auth") return "needs_auth";
  if (worker.lastSeenAt && Date.now() - worker.lastSeenAt.getTime() <= ONLINE_WINDOW_MS) {
    return "online";
  }
  return "offline";
}
