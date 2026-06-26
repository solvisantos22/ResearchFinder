import { MAX_DAILY_IDEAS, MAX_IDEAS_PER_PAPER } from "@/lib/v2/domain";

/**
 * Trim a generated inbox down to what the strict GeneratedInbox schema allows:
 * at most {@link MAX_DAILY_IDEAS} ideas total AND at most {@link MAX_IDEAS_PER_PAPER}
 * per paper. Models routinely overshoot either cap; without this the strict schema
 * would reject the whole inbox and the day's job would fail.
 *
 * Behaviour:
 * - operates on the loosely-typed parsed JSON (before strict validation);
 * - keeps the highest-`scores.overall` ideas, greedily, subject to the per-paper
 *   cap, until the daily cap is reached; ties break by document order;
 * - rebuilds papers in their original order, each keeping its surviving ideas in
 *   their original order, and drops any paper left with no ideas;
 * - returns the input untouched if it is already within both caps or does not look
 *   like an inbox, so the strict schema still raises the real validation error.
 *
 * Note: a structurally malformed paper (not an object, or `ideas` not an array) is
 * intentionally passed through so the schema surfaces the real corruption rather
 * than silently hiding it — only benign overshoot is salvaged here.
 */
export function clampGeneratedInboxIdeas(data: unknown): unknown {
  if (!isRecord(data) || !Array.isArray(data.papers)) {
    return data;
  }

  const papers = data.papers;
  const flat: Array<{ paperIndex: number; ideaIndex: number; overall: number; order: number }> = [];
  let overPerPaper = false;

  papers.forEach((paper, paperIndex) => {
    if (!isRecord(paper) || !Array.isArray(paper.ideas)) return;
    if (paper.ideas.length > MAX_IDEAS_PER_PAPER) overPerPaper = true;
    paper.ideas.forEach((idea, ideaIndex) => {
      flat.push({ paperIndex, ideaIndex, overall: readOverallScore(idea), order: flat.length });
    });
  });

  if (flat.length <= MAX_DAILY_IDEAS && !overPerPaper) {
    return data;
  }

  const kept = new Set<string>();
  const keptPerPaper = new Map<number, number>();
  for (const entry of [...flat].sort((a, b) => b.overall - a.overall || a.order - b.order)) {
    if (kept.size >= MAX_DAILY_IDEAS) break;
    if ((keptPerPaper.get(entry.paperIndex) ?? 0) >= MAX_IDEAS_PER_PAPER) continue;
    kept.add(`${entry.paperIndex}:${entry.ideaIndex}`);
    keptPerPaper.set(entry.paperIndex, (keptPerPaper.get(entry.paperIndex) ?? 0) + 1);
  }

  const trimmedPapers = papers
    .map((paper, paperIndex) => {
      if (!isRecord(paper) || !Array.isArray(paper.ideas)) return paper;
      return {
        ...paper,
        ideas: paper.ideas.filter((_idea, ideaIndex) => kept.has(`${paperIndex}:${ideaIndex}`))
      };
    })
    .filter((paper) => !isRecord(paper) || !Array.isArray(paper.ideas) || paper.ideas.length > 0);

  return { ...data, papers: trimmedPapers };
}

function readOverallScore(idea: unknown): number {
  if (isRecord(idea) && isRecord(idea.scores)) {
    const overall = idea.scores.overall;
    // Only a schema-valid score (a finite number in [0, 1]) counts. Unscored or
    // out-of-range ideas sort last so they are trimmed before valid ones.
    if (typeof overall === "number" && Number.isFinite(overall) && overall >= 0 && overall <= 1) {
      return overall;
    }
  }
  return Number.NEGATIVE_INFINITY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
