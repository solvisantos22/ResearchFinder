import { z } from "zod";

import { clampGeneratedInboxIdeas } from "@/lib/v2/clamp-inbox";
import {
  AnalysisResultSchema,
  CriticVerdictSchema,
  ExperimentResultSchema,
  GeneratedInboxSchema,
  LiteratureReviewSchema,
  NoveltyScanResultSchema,
  PaperResultSchema,
  ResearchPlanSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";

export function parseInboxGenerationOutput(raw: string) {
  return GeneratedInboxSchema.parse(clampGeneratedInboxIdeas(JSON.parse(raw)));
}

export function parseNoveltyScanOutput(
  raw: string,
  context: { jobId: string; generatedForUserId: string; inboxDate: string }
) {
  const parsed = stripNulls(JSON.parse(raw));
  const record =
    parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  // Codex sometimes renames the scans array ("results") and drops the job-context
  // fields (jobId/generatedForUserId/inboxDate). Pin those from the job (they are
  // authoritative) and accept either key for the array; null-strip + key-pruning
  // clean the rest so a sloppy wrapper doesn't 400 the whole scan.
  const scans = Array.isArray(record.scans)
    ? record.scans
    : Array.isArray(record.results)
      ? record.results
      : [];
  const normalized = {
    jobId: context.jobId,
    generatedForUserId: context.generatedForUserId,
    inboxDate: context.inboxDate,
    scans
  };
  return NoveltyScanResultSchema.parse(
    pruneUnrecognizedKeys(NoveltyScanResultSchema, normalized)
  );
}

export function parseViabilityOutput(raw: string) {
  return ViabilityResultSchema.parse(JSON.parse(raw));
}

const RESEARCH_STAGE_SCHEMAS = {
  plan: ResearchPlanSchema,
  literature: LiteratureReviewSchema,
  experiment: ExperimentResultSchema,
  analysis: AnalysisResultSchema,
  paper: PaperResultSchema
} as const;

const VALID_CITATION_SOURCE_TYPES = new Set([
  "paper",
  "related_work",
  "web",
  "generated_analysis"
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function looksLikeUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function clampUnitScore(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return 0.5;
}

// Codex emits `null` for "not applicable" optional fields (e.g. a metric's
// baseline), but the schemas use `.optional()` — which accepts `undefined`, not
// `null` — so a single null 400s the whole stage. Recursively drop null-valued
// keys so the field becomes absent (optional-friendly). Safe for stage OUTPUT
// schemas: none use a required `.nullable()` (the nullable fields live only in
// the JobInput schemas, validated elsewhere).
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === null) continue;
      result[key] = stripNulls(nested);
    }
    return result;
  }
  return value;
}

// Codex's free-form citations frequently violate the schema's strict CitationSchema
// in ways that 400 the entire stage and discard hours of real work: an out-of-union
// sourceType (e.g. "dataset"/"preprint"), a missing claim/confidence/title, a
// non-url "url", or extra keys (CitationSchema is a strictObject). Rebuild each
// citation to exactly the allowed, valid shape so one sloppy citation can't sink
// the stage. The critic still judges citation quality/substance.
function normalizeCitations<T>(parsed: T): T {
  if (parsed === null || typeof parsed !== "object") return parsed;
  const citations = (parsed as { citations?: unknown }).citations;
  if (!Array.isArray(citations)) return parsed;
  return {
    ...(parsed as Record<string, unknown>),
    citations: citations.map((citation) => {
      if (citation === null || typeof citation !== "object") return citation;
      const record = citation as Record<string, unknown>;

      const url = looksLikeUrl(record.url) ? record.url : "";
      let sourceType =
        typeof record.sourceType === "string" && VALID_CITATION_SOURCE_TYPES.has(record.sourceType)
          ? record.sourceType
          : "generated_analysis";
      // Only "generated_analysis" may carry an empty url; demote url-less citations.
      if (url === "" && sourceType !== "generated_analysis") {
        sourceType = "generated_analysis";
      }

      const normalized: Record<string, unknown> = {
        sourceType,
        url,
        title: isNonEmptyString(record.title) ? record.title : "Untitled source",
        claim: isNonEmptyString(record.claim) ? record.claim : "Cited in the research output.",
        confidence: clampUnitScore(record.confidence)
      };
      if (isNonEmptyString(record.sourceId)) {
        normalized.sourceId = record.sourceId;
      }
      return normalized;
    })
  } as T;
}

export type SourcePaperRef = {
  id: string;
  arxivId: string;
  url: string;
  title: string;
};

// The server requires every "paper" citation to be the project's source paper
// (exact url + matching sourceId), and at least one such citation. Codex tends
// to (a) cite the source paper with a slightly-off url/sourceId, and (b) label
// OTHER papers as "paper" instead of "related_work" — either trips the gate and
// discards the stage. We normalize worker-side so the submitted output passes:
// pin the source citation to the project's exact url+sourceId, demote other
// "paper" citations to "related_work", and inject the source citation if Codex
// omitted it. The critic still judges whether the grounding is substantive.
function groundCitationsToSourcePaper<T>(parsed: T, sourcePaper: SourcePaperRef): T {
  if (parsed === null || typeof parsed !== "object") return parsed;
  const citations = (parsed as { citations?: unknown }).citations;
  if (!Array.isArray(citations)) return parsed;

  const validSourceIds = new Set([sourcePaper.arxivId, sourcePaper.id]);
  let hasSourceCitation = false;

  const grounded = citations.map((citation) => {
    if (citation === null || typeof citation !== "object") return citation;
    const record = citation as Record<string, unknown>;
    if (record.sourceType !== "paper") return citation;

    const url = typeof record.url === "string" ? record.url : "";
    const sourceId = typeof record.sourceId === "string" ? record.sourceId : undefined;
    const looksLikeSource =
      url === sourcePaper.url ||
      (sourceId !== undefined && validSourceIds.has(sourceId)) ||
      (sourcePaper.arxivId.length > 0 && url.includes(sourcePaper.arxivId));

    if (looksLikeSource) {
      hasSourceCitation = true;
      return { ...record, sourceType: "paper", url: sourcePaper.url, sourceId: sourcePaper.arxivId };
    }
    return { ...record, sourceType: "related_work" };
  });

  if (!hasSourceCitation) {
    grounded.unshift({
      sourceType: "paper",
      url: sourcePaper.url,
      sourceId: sourcePaper.arxivId,
      title: sourcePaper.title,
      claim: "This research extends the source paper.",
      confidence: 1
    });
  }

  return { ...(parsed as Record<string, unknown>), citations: grounded } as T;
}

function getAtPath(root: unknown, path: ReadonlyArray<string | number>): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

// The stage schemas are strictObject, so an extra key Codex invents on a nested
// object (e.g. "partialScienceWorldDirection" on a hypothesisOutcome) 400s the
// whole stage. Rather than relax every schema (a server change needing a deploy),
// let Zod report exactly which keys are unrecognized and prune just those, then
// re-validate — schema-driven, works for any nested object on any stage, and the
// worker submits the pruned output so the server's strict schema accepts it.
function pruneUnrecognizedKeys(schema: z.ZodTypeAny, value: unknown): unknown {
  const current = value;
  for (let pass = 0; pass < 8; pass++) {
    const result = schema.safeParse(current);
    if (result.success) return current;
    const unknownKeyIssues = result.error.issues.filter(
      (issue): issue is z.ZodIssue & { keys: string[] } => issue.code === "unrecognized_keys"
    );
    if (unknownKeyIssues.length === 0) return current; // other errors: let the caller's parse throw
    for (const issue of unknownKeyIssues) {
      const target = getAtPath(current, issue.path);
      if (target !== null && typeof target === "object") {
        for (const key of issue.keys) {
          delete (target as Record<string, unknown>)[key];
        }
      }
    }
  }
  return current;
}

export function parseResearchStageOutput(
  stageType: string,
  raw: string,
  sourcePaper?: SourcePaperRef
) {
  const schema = RESEARCH_STAGE_SCHEMAS[stageType as keyof typeof RESEARCH_STAGE_SCHEMAS];
  if (!schema) {
    throw new Error(`No worker output schema for research stage "${stageType}"`);
  }
  let value = normalizeCitations(stripNulls(JSON.parse(raw)));
  if (sourcePaper) {
    value = groundCitationsToSourcePaper(value, sourcePaper);
  }
  value = pruneUnrecognizedKeys(schema, value);
  return schema.parse(value);
}

// Coerce a field the schema wants as a string but Codex returned as an array
// (e.g. feedback as a list of points) or an object. Arrays join to lines; objects
// stringify; strings and other scalars pass through for the schema to judge.
function coerceStringField(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join("\n");
  }
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

// The critic verdict has the same structural-drift risk as producer outputs:
// Codex returns feedback (and scorecard notes/criteria) as arrays/objects rather
// than strings. Coerce the string fields so a sloppy verdict isn't discarded.
function normalizeCriticVerdict(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== "object") return parsed;
  const record = { ...(parsed as Record<string, unknown>) };
  if ("feedback" in record) record.feedback = coerceStringField(record.feedback);
  if (Array.isArray(record.scorecard)) {
    record.scorecard = record.scorecard.map((entry) => {
      if (entry === null || typeof entry !== "object") return entry;
      const e = { ...(entry as Record<string, unknown>) };
      if ("criterion" in e) e.criterion = coerceStringField(e.criterion);
      if ("note" in e) e.note = coerceStringField(e.note);
      return e;
    });
  }
  return record;
}

export function parseCriticVerdict(raw: string) {
  const normalized = normalizeCriticVerdict(stripNulls(JSON.parse(raw)));
  return CriticVerdictSchema.parse(pruneUnrecognizedKeys(CriticVerdictSchema, normalized));
}
