import { fetchArxivPapers } from "@/lib/arxiv/client";

type GatherNoveltySourceEvidenceInput = {
  queries: string[];
  maxResultsPerQuery?: number;
};

type NoveltySourceEvidence = {
  sourceType: "arxiv" | "scholarly" | "web" | "github";
  title: string;
  url: string;
  sourceId?: string;
  claim: string;
  overlapLevel: "exact" | "close" | "adjacent" | "weak";
  confidence: number;
};

export async function gatherNoveltySourceEvidence(input: GatherNoveltySourceEvidenceInput) {
  const adaptersAttempted = ["arxiv", "openalex", "semantic_scholar"];
  const adaptersFailed: string[] = [];
  const evidence: NoveltySourceEvidence[] = [];
  const maxResults = input.maxResultsPerQuery ?? 3;

  for (const query of input.queries) {
    try {
      const papers = await fetchArxivPapers(query, maxResults, { sortBy: "relevance" });
      evidence.push(
        ...papers.map((paper) => ({
          sourceType: "arxiv" as const,
          title: paper.title,
          url: paper.url,
          sourceId: paper.arxivId,
          claim: paper.abstract.slice(0, 500),
          overlapLevel: "adjacent" as const,
          confidence: 0.6
        }))
      );
    } catch {
      adaptersFailed.push("arxiv");
    }

    try {
      evidence.push(...(await fetchOpenAlexEvidence(query, maxResults)));
    } catch {
      adaptersFailed.push("openalex");
    }

    try {
      evidence.push(...(await fetchSemanticScholarEvidence(query, maxResults)));
    } catch {
      adaptersFailed.push("semantic_scholar");
    }
  }

  return {
    adaptersAttempted,
    adaptersFailed: Array.from(new Set(adaptersFailed)),
    evidence: dedupeEvidence(evidence)
  };
}

async function fetchOpenAlexEvidence(
  query: string,
  maxResults: number
): Promise<NoveltySourceEvidence[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(maxResults));
  const response = await fetch(url, {
    headers: { "User-Agent": "research-finder/0.1 (mailto:researchfinder@example.com)" }
  });
  if (!response.ok) throw new Error(`OpenAlex failed with ${response.status}`);
  const body = (await response.json()) as { results?: Array<Record<string, unknown>> };

  return (body.results ?? []).map((work) => ({
    sourceType: "scholarly",
    title: readString(work.title, "Untitled OpenAlex work"),
    url: readString(work.doi, readString(work.id, "")),
    sourceId: readString(work.id, undefined),
    claim: readString(work.title, "OpenAlex matched this work."),
    overlapLevel: "adjacent",
    confidence: 0.55
  }));
}

async function fetchSemanticScholarEvidence(
  query: string,
  maxResults: number
): Promise<NoveltySourceEvidence[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(maxResults));
  url.searchParams.set("fields", "title,url,abstract,paperId");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Semantic Scholar failed with ${response.status}`);
  const body = (await response.json()) as { data?: Array<Record<string, unknown>> };

  return (body.data ?? []).map((paper) => ({
    sourceType: "scholarly",
    title: readString(paper.title, "Untitled Semantic Scholar paper"),
    url: readString(paper.url, ""),
    sourceId: readString(paper.paperId, undefined),
    claim: readString(
      paper.abstract,
      readString(paper.title, "Semantic Scholar matched this paper.")
    ),
    overlapLevel: "adjacent",
    confidence: 0.55
  }));
}

function dedupeEvidence(evidence: NoveltySourceEvidence[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.sourceType}:${item.url || item.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readString(value: unknown, fallback: string): string;
function readString(value: unknown, fallback: undefined): string | undefined;
function readString(value: unknown, fallback: string | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
