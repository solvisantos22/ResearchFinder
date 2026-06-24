import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { validateDispatchSettingsWithDefaults } from "@/lib/dispatch/service";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";
import { type Citation, ViabilityResultSchema } from "@/lib/v2/schemas";

const MAX_CLAIM_ATTEMPTS = 3;

export async function createV2ViabilityJob(input: {
  currentUserId: string;
  generatedIdeaId: string;
  sprintDepth?: string;
  autonomyLevel?: string;
}) {
  const settings = validateDispatchSettingsWithDefaults(input);
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
    throw new Error("Generated idea is not available for dispatch by this user");
  }

  return prisma.viabilityJob.create({
    data: {
      userId: input.currentUserId,
      ideaId: null,
      generatedIdeaId: idea.id,
      sprintDepth: settings.sprintDepth,
      autonomyLevel: settings.autonomyLevel,
      status: "queued"
    }
  });
}

export async function claimNextViabilityJob(input: { userId: string; workerId: string }) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const staleStartedBefore = staleRunningJobStartedBefore();
    const job = await prisma.viabilityJob.findFirst({
      where: {
        userId: input.userId,
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleStartedBefore } }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (!job) return null;

    const claim = await prisma.viabilityJob.updateMany({
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

    return prisma.viabilityJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        idea: {
          include: {
            paper: true
          }
        },
        generatedIdea: {
          include: {
            paper: true,
            citations: true
          }
        }
      }
    });
  }

  return null;
}

export async function completeV2ViabilityJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  const parsed = ViabilityResultSchema.parse(input.output);

  if (parsed.jobId !== input.jobId) {
    throw new Error("Viability output does not match completed job id");
  }

  await prisma.$transaction(async (tx) => {
    const job = await tx.viabilityJob.findFirst({
      where: {
        id: input.jobId,
        claimedByWorkerId: input.workerId,
        status: "running"
      },
      include: {
        idea: {
          include: {
            paper: true
          }
        },
        generatedIdea: {
          include: {
            paper: true
          }
        }
      }
    });

    if (!job) {
      throw new Error("Viability job is no longer running");
    }

    const sourcePaper = job.generatedIdea?.paper ?? job.idea?.paper;

    if (!sourcePaper) {
      throw new Error("Viability job is missing a source paper");
    }

    assertViabilityCitationsMatchSourcePaper(parsed.citations, {
      id: sourcePaper.id,
      arxivId: sourcePaper.arxivId,
      url: sourcePaper.url
    });

    const completion = await tx.viabilityJob.updateMany({
      where: {
        id: input.jobId,
        claimedByWorkerId: input.workerId,
        status: "running"
      },
      data: {
        status: "completed",
        verdict: parsed.verdict,
        completedAt: new Date()
      }
    });

    if (completion.count !== 1) {
      throw new Error("Viability job is no longer running");
    }

    await tx.evidence.createMany({
      data: parsed.citations.map((citation) => ({
        jobId: input.jobId,
        sourceTitle: citation.title,
        sourceUrl: citation.url,
        claim: citation.claim,
        support: parsed.summary,
        confidence: citation.confidence
      }))
    });
    await tx.artifact.create({
      data: {
        jobId: input.jobId,
        kind: "viability-report",
        title: `Viability result: ${parsed.verdict}`,
        content: JSON.stringify(parsed, null, 2)
      }
    });
  });
}

function assertViabilityCitationsMatchSourcePaper(
  citations: Citation[],
  sourcePaper: { id: string; arxivId: string; url: string }
) {
  const validSourceIds = new Set([sourcePaper.arxivId, sourcePaper.id]);
  let citesSourcePaper = false;

  for (const citation of citations) {
    if (citation.sourceType !== "paper") continue;

    const matchesSourcePaper =
      citation.url === sourcePaper.url &&
      citation.sourceId !== undefined &&
      validSourceIds.has(citation.sourceId);

    if (!matchesSourcePaper) {
      throw new Error("Viability source paper citation does not match the job source paper");
    }

    citesSourcePaper = true;
  }

  if (!citesSourcePaper) {
    throw new Error("Viability result must cite the job source paper");
  }
}
