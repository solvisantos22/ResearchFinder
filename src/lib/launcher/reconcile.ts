import { LAUNCHER_LANES, type LauncherLane } from "@/lib/v2/domain";

export function computeReconcilePlan(
  desired: { inbox: boolean; research: boolean },
  runningLanes: LauncherLane[]
): { toSpawn: LauncherLane[]; toKill: LauncherLane[] } {
  const running = new Set(runningLanes);
  const toSpawn: LauncherLane[] = [];
  const toKill: LauncherLane[] = [];
  for (const lane of LAUNCHER_LANES) {
    const wanted = lane === "inbox" ? desired.inbox : desired.research;
    if (wanted && !running.has(lane)) toSpawn.push(lane);
    if (!wanted && running.has(lane)) toKill.push(lane);
  }
  return { toSpawn, toKill };
}
