import { XMLParser } from "fast-xml-parser";

export type ArxivPaperInput = {
  arxivId: string;
  title: string;
  abstract: string;
  url: string;
  publishedAt: Date;
  updatedAt: Date;
  authors: string[];
  categories: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  trimValues: true
});

type ArxivAtomAuthor = {
  name?: unknown;
};

type ArxivAtomCategory = {
  term?: unknown;
};

type ArxivAtomEntry = {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  published?: unknown;
  updated?: unknown;
  author?: ArxivAtomAuthor | ArxivAtomAuthor[];
  category?: ArxivAtomCategory | ArxivAtomCategory[];
};

type ArxivAtomFeed = {
  feed?: {
    entry?: ArxivAtomEntry | ArxivAtomEntry[];
  };
};

export function parseArxivAtom(xml: string): ArxivPaperInput[] {
  const parsed = parser.parse(xml) as ArxivAtomFeed;
  const entries = Array.isArray(parsed.feed?.entry)
    ? parsed.feed.entry
    : parsed.feed?.entry
      ? [parsed.feed.entry]
      : [];

  return entries.map((entry) => {
    const url = normalizeText(entry.id);
    return {
      arxivId: url.split("/").at(-1) ?? url,
      title: cleanWhitespace(normalizeText(entry.title)),
      abstract: cleanWhitespace(normalizeText(entry.summary)),
      url,
      publishedAt: new Date(normalizeText(entry.published)),
      updatedAt: new Date(normalizeText(entry.updated)),
      authors: normalizeArray(entry.author).map((author) => cleanWhitespace(normalizeText(author.name))),
      categories: normalizeArray(entry.category)
        .map((category) => String(category.term ?? ""))
        .filter(Boolean)
    };
  });
}

export async function fetchArxivPapers(query: string, maxResults: number) {
  const params = new URLSearchParams({
    search_query: query,
    start: "0",
    max_results: String(maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending"
  });

  const response = await fetch(`https://export.arxiv.org/api/query?${params.toString()}`, {
    headers: {
      "User-Agent": "research-finder/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`arXiv fetch failed: ${response.status} ${response.statusText}`);
  }

  return parseArxivAtom(await response.text());
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "text" in value) {
    return String((value as { text: unknown }).text);
  }
  return String(value ?? "");
}
