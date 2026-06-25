type NoveltyQueryInput = {
  ideaTitle: string;
  ideaSummary: string;
  paperTitle: string;
  paperAbstract: string;
  keywords: string[];
  maxQueries?: number;
};

const DEFAULT_MAX_QUERIES = 5;

export function buildNoveltyQueries(input: NoveltyQueryInput) {
  const { main: titleMain, remainder: titleRemainder } = splitTitle(input.ideaTitle);
  const keywordPair = input.keywords.slice(0, 2);
  const paperPhrase = extractPhrase(input.paperTitle, input.paperAbstract);
  const summaryTerms = extractUnquotedTerms(input.ideaSummary, input.keywords);

  const candidates = [
    `"${firstWords(titleMain, 4)}" "benchmark"`,
    `"${firstWords(titleRemainder, 5)}"`,
    keywordPair.length >= 2 ? `"${keywordPair[1]}" "${keywordPair[0]}"` : "",
    paperPhrase ? `"${paperPhrase}" "benchmark"` : "",
    summaryTerms
  ];

  return dedupe(
    candidates
      .map((query) => query.replace(/\s+/g, " ").trim())
      .filter((query) => query.length > 3)
  ).slice(0, input.maxQueries ?? DEFAULT_MAX_QUERIES);
}

function splitTitle(title: string): { main: string; remainder: string } {
  if (title.includes(":")) {
    const parts = title.split(":");
    return { main: parts[0].trim(), remainder: parts.slice(1).join(":").trim() };
  }
  const forIdx = title.toLowerCase().indexOf(" for ");
  if (forIdx >= 0) {
    return { main: title.slice(0, forIdx).trim(), remainder: title.slice(forIdx + 5).trim() };
  }
  return { main: title, remainder: title };
}

function firstWords(value: string, count: number) {
  return value
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function extractPhrase(title: string, abstract: string) {
  const combined = `${title} ${abstract}`.toLowerCase();
  if (combined.includes("agentic synthetic data")) return "agentic synthetic data";
  if (combined.includes("shuffle invariance")) return "shuffle invariance";
  if (combined.includes("tool use")) return "tool use";
  if (combined.includes("benchmark")) return "benchmark";
  return firstWords(title, 4).toLowerCase();
}

function extractUnquotedTerms(summary: string, keywords: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  const summaryLower = summary.toLowerCase();

  // Add keyword words that also appear (or share a root) in the summary
  for (const kw of keywords) {
    for (const w of kw
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)) {
      const k = w.toLowerCase();
      if (seen.has(k)) continue;
      const root = k.slice(0, Math.max(4, k.length - 3));
      if (summaryLower.includes(k) || summaryLower.includes(root)) {
        seen.add(k);
        result.push(k);
      }
    }
  }

  // Add summary words > 6 chars, skipping words that are roots of already-seen terms
  for (const w of summary
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 6)) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    const isRootOfSeen = result.some((r) =>
      r.startsWith(k.slice(0, Math.max(4, k.length - 2)))
    );
    if (!isRootOfSeen) {
      seen.add(k);
      result.push(k);
    }
  }

  return result.slice(0, 6).join(" ");
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}
