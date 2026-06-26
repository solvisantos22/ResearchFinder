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

export type ArxivRetryOptions = {
  attempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
};

export type FetchArxivPapersOptions = {
  sortBy?: "relevance" | "lastUpdatedDate" | "submittedDate";
  sortOrder?: "ascending" | "descending";
  retry?: ArxivRetryOptions;
};

const DEFAULT_ARXIV_RETRY_ATTEMPTS = 3;
const DEFAULT_ARXIV_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_ARXIV_RETRY_BACKOFF_MS = 1_000;

export async function fetchArxivPapers(
  query: string,
  maxResults: number,
  options: FetchArxivPapersOptions = {}
): Promise<ArxivPaperInput[]> {
  const params = new URLSearchParams({
    search_query: query,
    start: "0",
    max_results: String(maxResults),
    sortBy: options.sortBy ?? "submittedDate",
    sortOrder: options.sortOrder ?? "descending"
  });
  const url = `https://export.arxiv.org/api/query?${params.toString()}`;

  const attempts = options.retry?.attempts ?? DEFAULT_ARXIV_RETRY_ATTEMPTS;
  const timeoutMs = options.retry?.timeoutMs ?? DEFAULT_ARXIV_FETCH_TIMEOUT_MS;
  const backoffMs = options.retry?.backoffMs ?? DEFAULT_ARXIV_RETRY_BACKOFF_MS;

  const xml = await fetchArxivXmlWithRetry(url, { attempts, timeoutMs, backoffMs });
  return parseArxivAtom(xml);
}

async function fetchArxivXmlWithRetry(
  url: string,
  { attempts, timeoutMs, backoffMs }: Required<ArxivRetryOptions>
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchArxivXml(url, timeoutMs);
    } catch (error) {
      if (attempt >= attempts || !isRetryableArxivError(error)) {
        throw error;
      }
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
}

async function fetchArxivXml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "research-finder/0.1"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`arXiv fetch failed: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableArxivError(error: unknown): boolean {
  // An HTTP error status won't be fixed by retrying, so surface it immediately.
  // Everything else here (a rejected fetch — "TypeError: fetch failed" — or an
  // abort from the timeout) is a transient network failure worth retrying.
  if (error instanceof Error && error.message.startsWith("arXiv fetch failed:")) {
    return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
