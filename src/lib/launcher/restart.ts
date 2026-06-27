import { prisma } from "@/lib/db";

// Set the restart flag for the user's active launcher(s). The launcher consumes it on its
// next /api/launcher/state poll and bounces its workers so they reload from disk. updateMany
// keeps this correct whether the user has zero, one, or several active launchers.
export async function requestLauncherRestart(userId: string): Promise<void> {
  await prisma.launcherRegistration.updateMany({
    where: { userId, status: "active", revokedAt: null },
    data: { restartRequestedAt: new Date() }
  });
}

// Atomically read-and-clear the restart flag for one launcher. Returns true at most once per
// request (the conditional updateMany clears only a set flag), so the launcher restarts its
// workers exactly once instead of looping every tick.
export async function consumeLauncherRestart(launcherId: string): Promise<boolean> {
  const cleared = await prisma.launcherRegistration.updateMany({
    where: { id: launcherId, restartRequestedAt: { not: null } },
    data: { restartRequestedAt: null }
  });
  return cleared.count > 0;
}
