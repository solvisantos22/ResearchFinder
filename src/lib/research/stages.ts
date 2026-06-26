import { ExperimentResultSchema, LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";
import { type ZodTypeAny } from "zod";

export const RESEARCH_STAGES = ["plan", "literature", "experiment", "analysis", "paper"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

// Stages with a worker executor today. Analysis/paper are added here (plus a
// STAGE_REGISTRY entry) as they are built; the harness then advances into them automatically.
export const EXECUTABLE_STAGES = ["plan", "literature", "experiment"] as const;
export type ExecutableStage = (typeof EXECUTABLE_STAGES)[number];

type StageDefinition = {
  outputSchema: ZodTypeAny;
  requiresSourcePaperCitation: boolean;
};

export const STAGE_REGISTRY: Record<ExecutableStage, StageDefinition> = {
  plan: { outputSchema: ResearchPlanSchema, requiresSourcePaperCitation: true },
  literature: { outputSchema: LiteratureReviewSchema, requiresSourcePaperCitation: true },
  experiment: { outputSchema: ExperimentResultSchema, requiresSourcePaperCitation: true }
};

// The next stage in pipeline order that currently has an executor, or null (terminal-for-now).
export function nextExecutableStage(after: ResearchStage): ResearchStage | null {
  const startIndex = RESEARCH_STAGES.indexOf(after);
  for (let i = startIndex + 1; i < RESEARCH_STAGES.length; i++) {
    const stage = RESEARCH_STAGES[i];
    if ((EXECUTABLE_STAGES as readonly ResearchStage[]).includes(stage)) return stage;
  }
  return null;
}
