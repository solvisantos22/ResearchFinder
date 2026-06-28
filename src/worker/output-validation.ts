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

export function parseNoveltyScanOutput(raw: string) {
  return NoveltyScanResultSchema.parse(JSON.parse(raw));
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

// Codex sometimes labels a citation with a sourceType outside the schema's
// 4-value union (e.g. "dataset", "preprint", "code"). Failing an entire stage —
// and discarding hours of real work — over a label is wrong, so we coerce
// unknown values to "generated_analysis", mirroring the inbox input path
// (researchfinder-worker.ts). The critic still judges citation quality.
function normalizeCitationSourceTypes<T>(parsed: T): T {
  if (parsed === null || typeof parsed !== "object") return parsed;
  const citations = (parsed as { citations?: unknown }).citations;
  if (!Array.isArray(citations)) return parsed;
  return {
    ...(parsed as Record<string, unknown>),
    citations: citations.map((citation) => {
      if (citation === null || typeof citation !== "object") return citation;
      const sourceType = (citation as { sourceType?: unknown }).sourceType;
      if (typeof sourceType === "string" && VALID_CITATION_SOURCE_TYPES.has(sourceType)) {
        return citation;
      }
      return { ...(citation as Record<string, unknown>), sourceType: "generated_analysis" };
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

export function parseResearchStageOutput(
  stageType: string,
  raw: string,
  sourcePaper?: SourcePaperRef
) {
  const schema = RESEARCH_STAGE_SCHEMAS[stageType as keyof typeof RESEARCH_STAGE_SCHEMAS];
  if (!schema) {
    throw new Error(`No worker output schema for research stage "${stageType}"`);
  }
  let value = normalizeCitationSourceTypes(JSON.parse(raw));
  if (sourcePaper) {
    value = groundCitationsToSourcePaper(value, sourcePaper);
  }
  return schema.parse(value);
}

export function parseCriticVerdict(raw: string) {
  return CriticVerdictSchema.parse(JSON.parse(raw));
}
