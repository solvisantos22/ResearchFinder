export const V2_JOB_TYPES = ["inbox_generation", "novelty_scan", "viability_check"] as const;
export type V2JobType = (typeof V2_JOB_TYPES)[number];

export const V2_JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "timed_out"
] as const;
export type V2JobStatus = (typeof V2_JOB_STATUSES)[number];

export const CALIBRATED_NOVELTY_LABELS = [
  "likely_novel",
  "unclear",
  "crowded",
  "near_duplicate",
  "not_checked"
] as const;
export type CalibratedNoveltyLabel = (typeof CALIBRATED_NOVELTY_LABELS)[number];

export const LEGACY_NOVELTY_STATUSES = [
  "verified",
  "needs_novelty_check",
  "not_novel"
] as const;
export type LegacyNoveltyStatus = (typeof LEGACY_NOVELTY_STATUSES)[number];

export const NOVELTY_STATUSES = [
  ...LEGACY_NOVELTY_STATUSES,
  ...CALIBRATED_NOVELTY_LABELS
] as const;
export type NoveltyStatus = (typeof NOVELTY_STATUSES)[number];

export const VIABILITY_VERDICTS = [
  "expand",
  "needs_novelty_check",
  "revise",
  "reject"
] as const;
export type ViabilityVerdict = (typeof VIABILITY_VERDICTS)[number];

export const SCORE_DIMENSIONS = [
  "relevance",
  "significance",
  "originality",
  "feasibility",
  "overall"
] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export const MAX_DAILY_IDEAS = 10;
export const MAX_IDEAS_PER_PAPER = 3;

export function clampUnitScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

export const RESEARCH_STAGES = ["plan", "literature", "experiment", "analysis", "paper"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

export const RESEARCH_PROJECT_STATUSES = ["running", "plan_ready", "aborted", "failed"] as const;
export type ResearchProjectStatus = (typeof RESEARCH_PROJECT_STATUSES)[number];
