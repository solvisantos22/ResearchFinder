import type { WorkerLane } from "@/lib/v2/domain";

// The full set of worker job types. This is intentionally a SUPERSET of
// `V2_JOB_TYPES` in domain.ts, which omits "research_plan" by design (a domain
// test pins V2_JOB_TYPES' contents). The two lists are kept separate on purpose.
export const WORKER_JOB_TYPES = [
  "inbox_generation",
  "novelty_scan",
  "viability_check",
  "research_plan",
  "research_literature",
  "research_experiment",
  "research_analysis"
] as const;
export type WorkerJobType = (typeof WORKER_JOB_TYPES)[number];

export const LANE_JOB_TYPES: Record<WorkerLane, readonly WorkerJobType[]> = {
  inbox: ["inbox_generation", "novelty_scan"],
  research: ["viability_check", "research_plan", "research_literature", "research_experiment", "research_analysis"],
  both: ["inbox_generation", "novelty_scan", "viability_check", "research_plan", "research_literature", "research_experiment", "research_analysis"]
};

// `lane` is a free-form String column; an unrecognized value (e.g. a future
// lane or legacy data) defaults to `both`, preserving today's claim-everything
// behavior rather than silently starving a worker.
export function laneClaimsJobType(lane: string, jobType: WorkerJobType): boolean {
  const allowed =
    (LANE_JOB_TYPES as Record<string, readonly WorkerJobType[] | undefined>)[lane] ??
    LANE_JOB_TYPES.both;
  return allowed.includes(jobType);
}
