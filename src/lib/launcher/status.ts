import { ONLINE_WINDOW_MS } from "@/lib/workers/status";
import { prisma } from "@/lib/db";

export type LauncherStatus = "online" | "offline";

export async function resolveLauncherStatusForUser(userId: string): Promise<LauncherStatus> {
  const launcher = await prisma.launcherRegistration.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { lastSeenAt: true }
  });
  if (!launcher) return "offline";
  if (launcher.lastSeenAt && Date.now() - launcher.lastSeenAt.getTime() <= ONLINE_WINDOW_MS) return "online";
  return "offline";
}
