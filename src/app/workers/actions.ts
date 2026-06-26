"use server";

import type { WorkerRegistrationActionState } from "@/components/WorkerSetupContent";
import { requireCurrentUser } from "@/lib/auth/session";
import { registerLauncherForUser } from "@/lib/jobs/launcher-registration";
import { registerWorkerForUser } from "@/lib/jobs/worker-registration";
import { getDesiredLanes, setLaneDesired } from "@/lib/launcher/desired-state";
import { resolveLauncherStatusForUser, type LauncherStatus } from "@/lib/launcher/status";
import { WORKER_LANES, type WorkerLane, type LauncherLane } from "@/lib/v2/domain";
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

export async function registerLauncher(): Promise<{ token: string }> {
  const currentUser = await requireCurrentUser();
  const { token } = await registerLauncherForUser({ userId: currentUser.id, label: "ResearchFinder Launcher" });
  return { token };
}

export async function setLaneDesiredAction(lane: LauncherLane, enabled: boolean): Promise<{ inbox: boolean; research: boolean }> {
  const currentUser = await requireCurrentUser();
  await setLaneDesired(currentUser.id, lane, enabled);
  return getDesiredLanes(currentUser.id);
}

export async function getLauncherOverview(): Promise<{ status: LauncherStatus; desired: { inbox: boolean; research: boolean } }> {
  const currentUser = await requireCurrentUser();
  const [status, desired] = await Promise.all([
    resolveLauncherStatusForUser(currentUser.id),
    getDesiredLanes(currentUser.id)
  ]);
  return { status, desired };
}
