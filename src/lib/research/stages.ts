import { AnalysisResultSchema, ExperimentResultSchema, LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";
import { type ZodTypeAny } from "zod";

export const RESEARCH_STAGES = ["plan", "literature", "experiment", "analysis", "paper"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

// Stages with a worker executor today. Paper is added here (plus a
// STAGE_REGISTRY entry) as it is built; the harness then advances into it automatically.
export const EXECUTABLE_STAGES = ["plan", "literature", "experiment", "analysis"] as const;
export type ExecutableStage = (typeof EXECUTABLE_STAGES)[number];

type StageDefinition = {
  outputSchema: ZodTypeAny;
  requiresSourcePaperCitation: boolean;
};

export const STAGE_REGISTRY: Record<ExecutableStage, StageDefinition> = {
  plan: { outputSchema: ResearchPlanSchema, requiresSourcePaperCitation: true },
  literature: { outputSchema: LiteratureReviewSchema, requiresSourcePaperCitation: true },
  experiment: { outputSchema: ExperimentResultSchema, requiresSourcePaperCitation: true },
  analysis: { outputSchema: AnalysisResultSchema, requiresSourcePaperCitation: true }
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

// Executable stages strictly after `stage`, in pipeline order. Used to supersede
// downstream artifacts on BACKTRACK and to find the next producer on PASS.
export function stagesAfter(stage: ResearchStage): ExecutableStage[] {
  const startIndex = RESEARCH_STAGES.indexOf(stage);
  const after: ExecutableStage[] = [];
  for (let i = startIndex + 1; i < RESEARCH_STAGES.length; i++) {
    const next = RESEARCH_STAGES[i];
    if ((EXECUTABLE_STAGES as readonly ResearchStage[]).includes(next)) {
      after.push(next as ExecutableStage);
    }
  }
  return after;
}

export function producerJobType(stage: ResearchStage): string {
  return `research_${stage}`;
}

export function criticJobType(stage: ResearchStage): string {
  return `research_${stage}_critic`;
}
