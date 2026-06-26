"use server";

import type { WorkerRegistrationActionState } from "@/components/WorkerSetupContent";
import { requireCurrentUser } from "@/lib/auth/session";
import { registerWorkerForUser } from "@/lib/jobs/worker-registration";
import { WORKER_LANES, type WorkerLane } from "@/lib/v2/domain";
import { getWorkersOverviewForUser, type WorkerOverviewRow } from "@/lib/workers/overview";

const DEFAULT_LABELS: Record<WorkerLane, string> = {
  inbox: "ResearchFinder Inbox Worker",
  research: "ResearchFinder Research Worker",
  both: "ResearchFinder Worker"
};

function readLane(value: FormDataEntryValue | null): WorkerLane {
  return WORKER_LANES.includes(value as WorkerLane) ? (value as WorkerLane) : "both";
}

export async function registerWorker(
  previousState: WorkerRegistrationActionState,
  formData: FormData
): Promise<WorkerRegistrationActionState> {
  void previousState;

  const currentUser = await requireCurrentUser();
  const lane = readLane(formData.get("lane"));
  const label = DEFAULT_LABELS[lane];
  const registration = await registerWorkerForUser({
    userId: currentUser.id,
    label,
    lane
  });

  return { token: registration.token, label, lane };
}

export async function getWorkersOverview(): Promise<WorkerOverviewRow[]> {
  const currentUser = await requireCurrentUser();
  return getWorkersOverviewForUser(currentUser.id);
}
