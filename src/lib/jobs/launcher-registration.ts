import { prisma } from "@/lib/db";
import { createWorkerToken, hashWorkerToken } from "@/lib/jobs/worker-auth";

export async function registerLauncherForUser(input: { userId: string; label: string }) {
  const token = createWorkerToken();
  const tokenHash = await hashWorkerToken(token);
  const launcher = await prisma.launcherRegistration.create({
    data: { userId: input.userId, label: input.label, tokenHash, status: "active" },
    select: { id: true }
  });
  return { launcherId: launcher.id, token };
}
