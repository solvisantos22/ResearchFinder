"use server";

import type { WorkerRegistrationActionState } from "@/components/WorkerSetupContent";
import { requireCurrentUser } from "@/lib/auth/session";
import { registerWorkerForUser } from "@/lib/jobs/worker-registration";
import type { WorkerStatus } from "@/components/WorkerStatusPanel";
import { resolveWorkerStatusForUser } from "@/lib/workers/status";

export async function registerWorker(
  previousState: WorkerRegistrationActionState
): Promise<WorkerRegistrationActionState> {
  void previousState;

  const currentUser = await requireCurrentUser();
  const registration = await registerWorkerForUser({
    userId: currentUser.id,
    label: "Local Codex worker"
  });

  return { token: registration.token };
}

export async function getCurrentWorkerStatus(): Promise<WorkerStatus> {
  const currentUser = await requireCurrentUser();
  return resolveWorkerStatusForUser(currentUser.id);
}
