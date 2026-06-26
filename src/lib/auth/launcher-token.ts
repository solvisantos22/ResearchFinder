import { isAllowedGoogleEmail } from "@/lib/auth/allowed-emails";
import { prisma } from "@/lib/db";
import { verifyWorkerToken } from "@/lib/jobs/worker-auth";

export async function findAllowedLauncherByToken(token: string) {
  const launchers = await prisma.launcherRegistration.findMany({
    where: { status: "active", revokedAt: null },
    select: { id: true, userId: true, tokenHash: true, user: { select: { email: true } } }
  });
  for (const launcher of launchers) {
    if (await verifyWorkerToken(token, launcher.tokenHash)) {
      return isAllowedGoogleEmail(launcher.user.email) ? { id: launcher.id, userId: launcher.userId } : null;
    }
  }
  return null;
}
