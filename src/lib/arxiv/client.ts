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

  return entries.map((entry, index) => {
    const url = readRequiredText(entry.id, index, "missing id");
    const arxivId = extractArxivId(url);

    if (!arxivId) {
      throw new Error(`Invalid arXiv entry at index ${index}: missing arxivId`);
    }

    return {
      arxivId,
      title: readRequiredText(entry.title, index, "missing title"),
      abstract: readRequiredText(entry.summary, index, "missing summary"),
      url,
      publishedAt: readRequiredDate(entry.published, index, "invalid published date"),
      updatedAt: readRequiredDate(entry.updated, index, "invalid updated date"),
      authors: normalizeArray(entry.author).map((author) => cleanWhitespace(normalizeText(author.name))),
      categories: normalizeArray(entry.category)
        .map((category) => String(category.term ?? ""))
        .filter(Boolean)
    };
  });
}

export async function fetchArxivPapers(query: string, maxResults: number): Promise<ArxivPaperInput[]> {
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

function extractArxivId(url: string): string {
  const absPrefix = "/abs/";
  const absIndex = url.indexOf(absPrefix);
  if (absIndex >= 0) {
    return url.slice(absIndex + absPrefix.length).trim();
  }

  return url.split("/").at(-1)?.trim() ?? "";
}

function readRequiredText(value: unknown, index: number, message: string): string {
  const normalized = cleanWhitespace(normalizeText(value));
  if (!normalized) {
    throw new Error(`Invalid arXiv entry at index ${index}: ${message}`);
  }

  return normalized;
}

function readRequiredDate(value: unknown, index: number, message: string): Date {
  const date = new Date(normalizeText(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid arXiv entry at index ${index}: ${message}`);
  }

  return date;
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
