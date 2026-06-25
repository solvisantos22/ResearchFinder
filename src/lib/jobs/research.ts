import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";
import { type Citation, ResearchPlanSchema, ViabilityResultSchema } from "@/lib/v2/schemas";

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

    await tx.researchPlanJob.create({
      data: {
        researchProjectId: project.id,
        userId: input.currentUserId,
        status: "queued",
        inputJson: JSON.stringify({ researchProjectId: project.id })
      }
    });

    return project;
  });
}

export async function claimNextResearchPlanJob(input: { userId: string; workerId: string }) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const staleStartedBefore = staleRunningJobStartedBefore();
    const job = await prisma.researchPlanJob.findFirst({
      where: {
        userId: input.userId,
        researchProject: { status: { not: "aborted" } },
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleStartedBefore } }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (!job) return null;

    const claim = await prisma.researchPlanJob.updateMany({
      where: {
        id: job.id,
        userId: input.userId,
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleStartedBefore } }
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

    return prisma.researchPlanJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        researchProject: {
          include: {
            generatedIdea: { include: { paper: true, citations: true } }
          }
        }
      }
    });
  }

  return null;
}

export async function completeResearchPlanJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  const parsed = ResearchPlanSchema.parse(input.output);

  await prisma.$transaction(async (tx) => {
    const job = await tx.researchPlanJob.findFirst({
      where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
      include: {
        researchProject: {
          include: { generatedIdea: { include: { paper: true } } }
        }
      }
    });

    if (!job) {
      throw new Error("Research plan job is no longer running");
    }

    if (parsed.researchProjectId !== job.researchProjectId) {
      throw new Error("Research plan output does not match the claimed project");
    }

    const sourcePaper = job.researchProject.generatedIdea.paper;
    assertCitesSourcePaper(parsed.citations, {
      id: sourcePaper.id,
      arxivId: sourcePaper.arxivId,
      url: sourcePaper.url
    });

    const completion = await tx.researchPlanJob.updateMany({
      where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
      data: { status: "completed", outputJson: JSON.stringify(parsed), completedAt: new Date() }
    });

    if (completion.count !== 1) {
      throw new Error("Research plan job is no longer running");
    }

    // Harness advance, abort-safe: only advance a project that has not been aborted.
    // An abort can commit concurrently while this stage runs, so we gate the advance
    // on the project's CURRENT status via a conditional updateMany rather than the
    // in-memory snapshot loaded above — a stale snapshot must not resurrect an aborted
    // project. A later sub-project replaces "plan_ready" with "enqueue the next stage".
    const advance = await tx.researchProject.updateMany({
      where: { id: job.researchProjectId, status: { not: "aborted" } },
      data: { status: "plan_ready" }
    });

    // Project was aborted (or removed) between claim and completion: the job is
    // recorded completed above, but no plan is persisted and no advance happens.
    if (advance.count !== 1) {
      return;
    }

    await tx.researchPlan.create({
      data: { researchProjectId: job.researchProjectId, planJson: JSON.stringify(parsed) }
    });
  });
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
      planJob: true,
      plan: true
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
      throw new Error("Research plan source paper citation does not match the project source paper");
    }

    citesSourcePaper = true;
  }

  if (!citesSourcePaper) {
    throw new Error("Research plan must cite the project source paper");
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
