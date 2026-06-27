import {
  EXECUTABLE_STAGES,
  stagesAfter,
  type ExecutableStage,
  type ResearchStage
} from "@/lib/research/stages";
import type { ResearchProjectStatus } from "@/lib/v2/domain";
import type { CriticVerdict } from "@/lib/v2/schemas";

// Budgets exist only to stop infinite ping-pong; within them the loop grinds freely.
export const MAX_REDOS_PER_STAGE = 3;
export const MAX_BACKTRACKS = 5;
export const MAX_PRODUCER_RUNS = 30;

export type RouteAction =
  | {
      type: "enqueue_producer";
      stage: ExecutableStage;
      attempt: number;
      feedback: string | null;
      incrementProducerRuns: true;
    }
  | {
      type: "backtrack";
      targetStage: ExecutableStage;
      attempt: number;
      feedback: string;
      supersedeAfter: ExecutableStage;
    }
  | { type: "set_status"; status: ResearchProjectStatus };

type ProjectBudget = { producerRunsUsed: number; backtracksUsed: number };
type JobMeta = { attempt: number };

function previousExecutableStage(stage: ResearchStage): ExecutableStage | null {
  const index = (EXECUTABLE_STAGES as readonly ResearchStage[]).indexOf(stage);
  if (index <= 0) return null;
  return EXECUTABLE_STAGES[index - 1];
}

// Pure router: maps a critic verdict + the project's budget counters + the judged
// job's attempt to a single deterministic action. No DB, no side effects.
export function routeAfterCritic(
  verdict: CriticVerdict,
  project: ProjectBudget,
  jobMeta: JobMeta
): RouteAction {
  const stage = verdict.stageType as ExecutableStage;

  if (verdict.verdict === "PASS") {
    const [next] = stagesAfter(stage);
    if (!next) return { type: "set_status", status: "analysis_ready" };
    return {
      type: "enqueue_producer",
      stage: next,
      attempt: 1,
      feedback: null,
      incrementProducerRuns: true
    };
  }

  // REDO and BACKTRACK both want to launch another producer run: enforce the total cap first.
  if (project.producerRunsUsed >= MAX_PRODUCER_RUNS) {
    return { type: "set_status", status: "needs_review" };
  }

  if (verdict.verdict === "REDO") {
    // feedback is guaranteed present for non-PASS verdicts by CriticVerdictSchema.
    const feedback = verdict.feedback as string;
    if (jobMeta.attempt < MAX_REDOS_PER_STAGE) {
      return {
        type: "enqueue_producer",
        stage,
        attempt: jobMeta.attempt + 1,
        feedback,
        incrementProducerRuns: true
      };
    }
    // Per-stage REDO cap hit: escalate to a backtrack to the previous stage (root cause upstream).
    const previous = previousExecutableStage(stage);
    if (!previous || project.backtracksUsed >= MAX_BACKTRACKS) {
      return { type: "set_status", status: "needs_review" };
    }
    // A backtrack starts a fresh visit to the target stage, so its REDO counter resets to 1.
    return { type: "backtrack", targetStage: previous, attempt: 1, feedback, supersedeAfter: previous };
  }

  // BACKTRACK
  const targetStage = verdict.targetStage as ExecutableStage;
  const feedback = verdict.feedback as string;
  if (project.backtracksUsed >= MAX_BACKTRACKS) {
    return { type: "set_status", status: "needs_review" };
  }
  // A backtrack starts a fresh visit to the target stage, so its REDO counter resets to 1.
  return { type: "backtrack", targetStage, attempt: 1, feedback, supersedeAfter: targetStage };
}
