import { prisma } from "@/lib/db";
import { createWorkerToken, hashWorkerToken } from "@/lib/jobs/worker-auth";
import type { LauncherLane } from "@/lib/v2/domain";

export async function getDesiredLanes(userId: string): Promise<{ inbox: boolean; research: boolean }> {
  const row = await prisma.workerLaneDesiredState.findUnique({ where: { userId } });
  return { inbox: row?.inboxEnabled ?? false, research: row?.researchEnabled ?? false };
}

export async function setLaneDesired(userId: string, lane: LauncherLane, enabled: boolean) {
  const field = lane === "inbox" ? "inboxEnabled" : "researchEnabled";
  await prisma.workerLaneDesiredState.upsert({
    where: { userId },
    update: { [field]: enabled },
    create: { userId, [field]: enabled }
  });
}

const LAUNCHER_WORKER_LABEL: Record<LauncherLane, string> = {
  inbox: "Launcher Inbox worker",
  research: "Launcher Research worker"
};

// Ensure exactly one launcher-managed worker registration per (user, lane), rotate its
// token, and return the fresh plaintext. Rotation invalidates any orphaned worker from a
// previous launcher run (it gets 401 on its next claim and exits).
export async function provisionLaneWorkerToken(userId: string, lane: LauncherLane): Promise<{ token: string }> {
  const token = createWorkerToken();
  const tokenHash = await hashWorkerToken(token);

  const existing = await prisma.workerRegistration.findMany({
    where: { userId, lane, launcherManaged: true },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });

  if (existing.length === 0) {
    await prisma.workerRegistration.create({
      data: { userId, lane, launcherManaged: true, label: LAUNCHER_WORKER_LABEL[lane], tokenHash, status: "active" }
    });
  } else {
    const [canonical, ...extras] = existing;
    await prisma.workerRegistration.update({
      where: { id: canonical.id },
      data: { tokenHash, status: "active", revokedAt: null }
    });
    // Defensive: a transient second launcher could have created duplicate launcher-managed rows.
    // Revoke the extras so no orphaned token survives rotation (auth excludes revokedAt != null).
    if (extras.length > 0) {
      await prisma.workerRegistration.updateMany({
        where: { id: { in: extras.map((e) => e.id) } },
        data: { status: "revoked", revokedAt: new Date() }
      });
    }
  }
  return { token };
}
