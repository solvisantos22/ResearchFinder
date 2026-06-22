import { type RankingWeights, ScoreBreakdown, clampScore, computeOverallScore } from "@/lib/domain";

type PaperLike = {
  title: string;
  abstract: string;
  categories: string[];
};

type ProfileLike = {
  interests: string[];
  preferredOutputs: string[];
  rankingWeights?: RankingWeights;
  rankingWeightsJson?: string;
};

const qualityTerms = [
  "benchmark",
  "dataset",
  "evaluation",
  "state-of-the-art",
  "reproducible",
  "failure",
  "reasoning",
  "agent"
];

const dispatchTerms = [
  "benchmark",
  "dataset",
  "evaluation",
  "simulation",
  "tool",
  "open-source",
  "prompt",
  "analysis"
];

const dispatchPenaltyTerms = ["pretrain", "billion", "trillion", "hardware", "clinical"];

export type RankedScore = ScoreBreakdown & { overall: number };

export function scorePaperForProfile(paper: PaperLike, profile: ProfileLike): RankedScore {
  const text = `${paper.title} ${paper.abstract} ${paper.categories.join(" ")}`.toLowerCase();
  const profileTerms = [...profile.interests, ...profile.preferredOutputs].flatMap(tokenize);

  const relevanceHits = new Set(tokenize(text).filter((token) => profileTerms.includes(token)));
  const profileCoverage = profileTerms.length === 0 ? 0.5 : relevanceHits.size / profileTerms.length;

  const paperQuality = clampScore(0.35 + countTermHits(text, qualityTerms) * 0.065);
  const projectOpportunity = clampScore(0.3 + Math.sqrt(profileCoverage) * 0.6);
  const dispatchLikelihood = clampScore(
    0.5 + countTermHits(text, dispatchTerms) * 0.06 - countTermHits(text, dispatchPenaltyTerms) * 0.08
  );

  const scores = { paperQuality, projectOpportunity, dispatchLikelihood };
  return {
    ...scores,
    overall: computeOverallScore(scores, resolveRankingWeights(profile))
  };
}

function resolveRankingWeights(profile: ProfileLike): RankingWeights | undefined {
  if (isValidRankingWeights(profile.rankingWeights)) {
    return profile.rankingWeights;
  }

  if (profile.rankingWeightsJson) {
    try {
      const parsed = JSON.parse(profile.rankingWeightsJson) as Partial<RankingWeights>;
      if (isValidRankingWeights(parsed)) {
        return parsed;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function isValidRankingWeights(weights: Partial<RankingWeights> | undefined): weights is RankingWeights {
  if (!weights) {
    return false;
  }

  const { paperQuality, projectOpportunity, dispatchLikelihood } = weights;
  return (
    typeof paperQuality === "number" &&
    Number.isFinite(paperQuality) &&
    paperQuality >= 0 &&
    typeof projectOpportunity === "number" &&
    Number.isFinite(projectOpportunity) &&
    projectOpportunity >= 0 &&
    typeof dispatchLikelihood === "number" &&
    Number.isFinite(dispatchLikelihood) &&
    dispatchLikelihood >= 0 &&
    paperQuality + projectOpportunity + dispatchLikelihood > 0
  );
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
}

function countTermHits(text: string, terms: string[]): number {
  return terms.filter((term) => text.includes(term)).length;
}
