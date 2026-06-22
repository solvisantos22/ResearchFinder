export const SPRINT_DEPTHS = ["fast", "default", "deep"] as const;
export type SprintDepth = (typeof SPRINT_DEPTHS)[number];

export const AUTONOMY_LEVELS = ["low", "medium", "high"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const DECISIONS = ["expand", "revise", "save", "discard"] as const;
export type Decision = (typeof DECISIONS)[number];

export type ScoreBreakdown = {
  paperQuality: number;
  projectOpportunity: number;
  dispatchLikelihood: number;
};

export type RankingWeights = {
  paperQuality: number;
  projectOpportunity: number;
  dispatchLikelihood: number;
};

export const defaultRankingWeights: RankingWeights = {
  paperQuality: 0.35,
  projectOpportunity: 0.4,
  dispatchLikelihood: 0.25
};

export const sprintDepthConfig: Record<
  SprintDepth,
  { expectedDuration: string; description: string }
> = {
  fast: {
    expectedDuration: "10-20 minutes",
    description: "Novelty and feasibility triage with a lightweight experiment sketch."
  },
  default: {
    expectedDuration: "1-3 hours",
    description: "Minimal prototype attempt or concrete experiment design with evidence."
  },
  deep: {
    expectedDuration: "6-12 hours",
    description: "Overnight-style related-work search and stronger prototype attempt."
  }
};

export const autonomyConfig: Record<AutonomyLevel, { description: string }> = {
  low: {
    description: "Read, summarize, and propose experiments only."
  },
  medium: {
    description:
      "Create files, small scripts, experiment plans, and artifacts; ask before expensive external spend."
  },
  high: {
    description:
      "Run code, call APIs, fetch datasets, and spend within the configured budget."
  }
};

export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

export function computeOverallScore(
  scores: ScoreBreakdown,
  weights: RankingWeights = defaultRankingWeights
): number {
  const totalWeight =
    weights.paperQuality + weights.projectOpportunity + weights.dispatchLikelihood;

  const weighted =
    scores.paperQuality * weights.paperQuality +
    scores.projectOpportunity * weights.projectOpportunity +
    scores.dispatchLikelihood * weights.dispatchLikelihood;

  return clampScore(weighted / totalWeight);
}
