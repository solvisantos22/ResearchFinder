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

export function parseResearchStageOutput(stageType: string, raw: string) {
  const schema = RESEARCH_STAGE_SCHEMAS[stageType as keyof typeof RESEARCH_STAGE_SCHEMAS];
  if (!schema) {
    throw new Error(`No worker output schema for research stage "${stageType}"`);
  }
  return schema.parse(normalizeCitationSourceTypes(JSON.parse(raw)));
}

export function parseCriticVerdict(raw: string) {
  return CriticVerdictSchema.parse(JSON.parse(raw));
}
