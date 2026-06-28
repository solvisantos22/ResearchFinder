import { Prisma } from "@prisma/client";

import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";
import {
  EXECUTABLE_STAGES,
  STAGE_REGISTRY,
  stagesAfter,
  type ExecutableStage,
  type ResearchStage
} from "@/lib/research/stages";
import { routeAfterCritic } from "@/lib/research/router";
import { type Citation, CriticVerdictSchema, ViabilityResultSchema } from "@/lib/v2/schemas";

const MAX_CLAIM_ATTEMPTS = 3;

export async function developIdea(input: { currentUserId: string; generatedIdeaId: string }) {
  const idea = await prisma.generatedIdea.findUnique({
    where: { id: input.generatedIdeaId },
    select: { id: true, userId: true }
  });

  if (
    !idea ||
    !canDispatchIdeaForProfile({
      currentUserId: input.currentUserId,
      generatedForUserId: idea.userId
    })
  ) {
    throw new Error("Generated idea is not available for development by this user");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.researchProject.findFirst({
      where: { generatedIdeaId: idea.id, userId: input.currentUserId, status: { not: "aborted" } },
      orderBy: { createdAt: "desc" }
    });
    if (existing) return existing;

    const latestViability = await tx.viabilityJob.findFirst({
      where: { generatedIdeaId: idea.id, userId: input.currentUserId, status: "completed" },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });

    const project = await tx.researchProject.create({
      data: {
        userId: input.currentUserId,
        generatedIdeaId: idea.id,
        sourceViabilityJobId: latestViability?.id ?? null,
        status: "running",
        currentStage: "plan"
      }
    });

    await tx.researchStageJob.create({
      data: {
        researchProjectId: project.id,
        userId: input.currentUserId,
        stageType: "plan",
        status: "queued",
        inputJson: JSON.stringify({ researchProjectId: project.id })
      }
    });

    return project;
  });
}

export async function claimNextResearchStageJob(input: { userId: string; workerId: string }) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const staleStartedBefore = staleRunningJobStartedBefore();
    const job = await prisma.researchStageJob.findFirst({
      where: {
        userId: input.userId,
        stageType: { in: [...EXECUTABLE_STAGES] },
        researchProject: { status: { not: "aborted" } },
        OR: [
          { status: "queued" },
          { status: "running", heartbeatAt: { lte: staleStartedBefore } },
          { status: "running", heartbeatAt: null, startedAt: { lte: staleStartedBefore } }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (!job) return null;

    const claim = await prisma.researchStageJob.updateMany({
      where: {
        id: job.id,
        userId: input.userId,
        OR: [
          { status: "queued" },
          { status: "running", heartbeatAt: { lte: staleStartedBefore } },
          { status: "running", heartbeatAt: null, startedAt: { lte: staleStartedBefore } }
        ]
      },
      data: {
        status: "running",
        claimedByWorkerId: input.workerId,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null
      }
    });

    if (claim.count !== 1) continue;

    return prisma.researchStageJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        researchProject: {
          include: {
            generatedIdea: { include: { paper: true, citations: true } },
            stageArtifacts: true
          }
        }
      }
    });
  }

  return null;
}

async function loadStageJobForCompletion(
  tx: Prisma.TransactionClient,
  jobId: string,
  workerId: string
) {
  return tx.researchStageJob.findFirst({
    where: { id: jobId, claimedByWorkerId: workerId, status: "running" },
    include: { researchProject: { include: { generatedIdea: { include: { paper: true } } } } }
  });
}

type LoadedStageJob = NonNullable<Awaited<ReturnType<typeof loadStageJobForCompletion>>>;

export async function completeResearchStageJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  await prisma.$transaction(async (tx) => {
    const job = await loadStageJobForCompletion(tx, input.jobId, input.workerId);

    if (!job) {
      throw new Error("Research stage job is no longer running");
    }

    if (job.kind === "critic") {
      await completeCriticJob(tx, job, input);
      return;
    }

    await completeProducerJob(tx, job, input);
  });
}

async function completeProducerJob(
  tx: Prisma.TransactionClient,
  job: LoadedStageJob,
  input: { jobId: string; workerId: string; output: unknown }
) {
  const stage = job.stageType as ResearchStage;
  const definition = STAGE_REGISTRY[stage as ExecutableStage];
  if (!definition) {
    throw new Error(`No registry entry for research stage "${job.stageType}"`);
  }

  const parsed = definition.outputSchema.parse(input.output) as {
    researchProjectId: string;
    citations: Citation[];
  };

  if (parsed.researchProjectId !== job.researchProjectId) {
    throw new Error("Research stage output does not match the claimed project");
  }

  if (definition.requiresSourcePaperCitation) {
    const sourcePaper = job.researchProject.generatedIdea.paper;
    assertCitesSourcePaper(parsed.citations, {
      id: sourcePaper.id,
      arxivId: sourcePaper.arxivId,
      url: sourcePaper.url
    });
  }

  const completion = await tx.researchStageJob.updateMany({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    data: { status: "completed", outputJson: JSON.stringify(parsed), completedAt: new Date() }
  });
  if (completion.count !== 1) {
    throw new Error("Research stage job is no longer running");
  }

  // Abort-safe: gate the critic enqueue on the project still being non-aborted.
  const advance = await tx.researchProject.updateMany({
    where: { id: job.researchProjectId, status: { not: "aborted" } },
    data: { currentStage: stage, status: "running" }
  });
  if (advance.count !== 1) {
    return; // aborted concurrently: record the completed job, but persist nothing further
  }

  // Supersede any prior live artifact for this stage, then persist the fresh one.
  await tx.researchStageArtifact.updateMany({
    where: { researchProjectId: job.researchProjectId, stageType: stage, supersededAt: null },
    data: { supersededAt: new Date() }
  });
  await tx.researchStageArtifact.create({
    data: { researchProjectId: job.researchProjectId, stageType: stage, artifactJson: JSON.stringify(parsed) }
  });

  // Enqueue the critic for this stage.
  await tx.researchStageJob.create({
    data: {
      researchProjectId: job.researchProjectId,
      userId: job.userId,
      stageType: stage,
      kind: "critic",
      status: "queued",
      inputJson: JSON.stringify({ researchProjectId: job.researchProjectId, stageType: stage })
    }
  });
}

async function completeCriticJob(
  tx: Prisma.TransactionClient,
  job: LoadedStageJob,
  input: { jobId: string; workerId: string; output: unknown }
) {
  const verdict = CriticVerdictSchema.parse(input.output);
  if (verdict.researchProjectId !== job.researchProjectId) {
    throw new Error("Critic verdict does not match the claimed project");
  }
  if (verdict.stageType !== job.stageType) {
    throw new Error("Critic verdict stage does not match the claimed critic job");
  }

  const completion = await tx.researchStageJob.updateMany({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    data: { status: "completed", verdictJson: JSON.stringify(verdict), completedAt: new Date() }
  });
  if (completion.count !== 1) {
    throw new Error("Research stage job is no longer running");
  }

  const action = routeAfterCritic(
    verdict,
    {
      producerRunsUsed: job.researchProject.producerRunsUsed,
      backtracksUsed: job.researchProject.backtracksUsed
    },
    { attempt: job.attempt }
  );

  if (action.type === "set_status") {
    // Abort-safe: never resurrect an aborted project.
    await tx.researchProject.updateMany({
      where: { id: job.researchProjectId, status: { not: "aborted" } },
      data: { status: action.status }
    });
    return;
  }

  if (action.type === "enqueue_producer") {
    const advance = await tx.researchProject.updateMany({
      where: { id: job.researchProjectId, status: { not: "aborted" } },
      data: { currentStage: action.stage, status: "running", producerRunsUsed: { increment: 1 } }
    });
    if (advance.count !== 1) return;
    await tx.researchStageJob.create({
      data: {
        researchProjectId: job.researchProjectId,
        userId: job.userId,
        stageType: action.stage,
        kind: "producer",
        attempt: action.attempt,
        feedback: action.feedback,
        status: "queued",
        inputJson: JSON.stringify({ researchProjectId: job.researchProjectId })
      }
    });
    return;
  }

  // action.type === "backtrack"
  const advance = await tx.researchProject.updateMany({
    where: { id: job.researchProjectId, status: { not: "aborted" } },
    data: {
      currentStage: action.targetStage,
      status: "running",
      producerRunsUsed: { increment: 1 },
      backtracksUsed: { increment: 1 }
    }
  });
  if (advance.count !== 1) return;

  // Supersede every live artifact for stages strictly after the target.
  const downstream = stagesAfter(action.supersedeAfter);
  if (downstream.length > 0) {
    await tx.researchStageArtifact.updateMany({
      where: {
        researchProjectId: job.researchProjectId,
        stageType: { in: downstream },
        supersededAt: null
      },
      data: { supersededAt: new Date() }
    });
  }

  await tx.researchStageJob.create({
    data: {
      researchProjectId: job.researchProjectId,
      userId: job.userId,
      stageType: action.targetStage,
      kind: "producer",
      attempt: action.attempt,
      feedback: action.feedback,
      status: "queued",
      inputJson: JSON.stringify({ researchProjectId: job.researchProjectId })
    }
  });
}

export async function failResearchStageJob(input: { jobId: string; errorMessage: string }) {
  await prisma.$transaction(async (tx) => {
    const job = await tx.researchStageJob.findUnique({
      where: { id: input.jobId },
      select: { researchProjectId: true }
    });

    if (!job) return;

    await tx.researchStageJob.updateMany({
      where: { id: input.jobId, status: { in: ["queued", "running"] } },
      data: { status: "failed", errorMessage: input.errorMessage, completedAt: new Date() }
    });

    await tx.researchProject.updateMany({
      where: { id: job.researchProjectId, status: "running" },
      data: { status: "failed" }
    });
  });
}

export async function recordResearchStageHeartbeat(input: {
  jobId: string;
  workerId: string;
}): Promise<{ aborted: boolean } | null> {
  const job = await prisma.researchStageJob.findFirst({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    select: { researchProject: { select: { status: true } } }
  });

  if (!job) return null;

  await prisma.researchStageJob.updateMany({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    data: { heartbeatAt: new Date() }
  });

  return { aborted: job.researchProject.status === "aborted" };
}

export async function abortResearchProject(input: {
  currentUserId: string;
  researchProjectId: string;
}) {
  const project = await prisma.researchProject.findUnique({
    where: { id: input.researchProjectId },
    select: { userId: true }
  });

  if (!project || project.userId !== input.currentUserId) {
    throw new Error("Research project is not available to this user");
  }

  await prisma.researchProject.update({
    where: { id: input.researchProjectId },
    data: { status: "aborted" }
  });
}

export async function listResearchProjectsForUser(userId: string) {
  return prisma.researchProject.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { generatedIdea: { select: { title: true } } }
  });
}

export async function getResearchProjectDetail(input: { currentUserId: string; projectId: string }) {
  const project = await prisma.researchProject.findUnique({
    where: { id: input.projectId },
    include: {
      generatedIdea: { include: { paper: true } },
      stageJobs: { orderBy: { createdAt: "asc" } },
      stageArtifacts: true
    }
  });

  if (!project || project.userId !== input.currentUserId) return null;
  return project;
}

function assertCitesSourcePaper(
  citations: Citation[],
  sourcePaper: { id: string; arxivId: string; url: string }
) {
  const validSourceIds = new Set([sourcePaper.arxivId, sourcePaper.id]);
  let citesSourcePaper = false;

  for (const citation of citations) {
    if (citation.sourceType !== "paper") continue;

    const matches =
      citation.url === sourcePaper.url &&
      citation.sourceId !== undefined &&
      validSourceIds.has(citation.sourceId);

    if (!matches) {
      throw new Error("Research stage source paper citation does not match the project source paper");
    }

    citesSourcePaper = true;
  }

  if (!citesSourcePaper) {
    throw new Error("Research stage must cite the project source paper");
  }
}

export function buildViabilityContextFromArtifactContent(content: string) {
  try {
    const parsed = ViabilityResultSchema.safeParse(JSON.parse(content));
    if (!parsed.success) return null;
    return {
      verdict: parsed.data.verdict,
      summary: parsed.data.summary,
      feasibility: parsed.data.feasibility,
      noveltyRisk: parsed.data.noveltyRisk,
      minimumExperiment: parsed.data.minimumExperiment,
      blockers: parsed.data.blockers
    };
  } catch {
    return null;
  }
}
