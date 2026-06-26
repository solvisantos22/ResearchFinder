"use server";

import type { WorkerRegistrationActionState } from "@/components/WorkerSetupContent";
import { requireCurrentUser } from "@/lib/auth/session";
import { registerWorkerForUser } from "@/lib/jobs/worker-registration";
import { getWorkersOverviewForUser, type WorkerOverviewRow } from "@/lib/workers/overview";

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

export async function getWorkersOverview(): Promise<WorkerOverviewRow[]> {
  const currentUser = await requireCurrentUser();
  return getWorkersOverviewForUser(currentUser.id);
}
