import { clampGeneratedInboxIdeas } from "@/lib/v2/clamp-inbox";
import {
  AnalysisResultSchema,
  CriticVerdictSchema,
  ExperimentResultSchema,
  GeneratedInboxSchema,
  LiteratureReviewSchema,
  NoveltyScanResultSchema,
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
  analysis: AnalysisResultSchema
} as const;

export function parseResearchStageOutput(stageType: string, raw: string) {
  const schema = RESEARCH_STAGE_SCHEMAS[stageType as keyof typeof RESEARCH_STAGE_SCHEMAS];
  if (!schema) {
    throw new Error(`No worker output schema for research stage "${stageType}"`);
  }
  return schema.parse(JSON.parse(raw));
}

export function parseCriticVerdict(raw: string) {
  return CriticVerdictSchema.parse(JSON.parse(raw));
}
