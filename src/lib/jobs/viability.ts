import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { validateDispatchSettingsWithDefaults } from "@/lib/dispatch/service";
import { ViabilityResultSchema } from "@/lib/v2/schemas";

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
    const job = await prisma.viabilityJob.findFirst({
      where: {
        userId: input.userId,
        status: "queued"
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (!job) return null;

    const claim = await prisma.viabilityJob.updateMany({
      where: {
        id: job.id,
        userId: input.userId,
        status: "queued"
      },
      data: {
        status: "running",
        claimedByWorkerId: input.workerId,
        startedAt: new Date(),
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

  const job = await prisma.viabilityJob.findFirstOrThrow({
    where: {
      id: input.jobId,
      claimedByWorkerId: input.workerId,
      status: "running"
    }
  });

  await prisma.$transaction([
    prisma.evidence.createMany({
      data: parsed.citations.map((citation) => ({
        jobId: job.id,
        sourceTitle: citation.title,
        sourceUrl: citation.url,
        claim: citation.claim,
        support: parsed.summary,
        confidence: citation.confidence
      }))
    }),
    prisma.artifact.create({
      data: {
        jobId: job.id,
        kind: "viability-report",
        title: `Viability result: ${parsed.verdict}`,
        content: JSON.stringify(parsed, null, 2)
      }
    }),
    prisma.viabilityJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        verdict: parsed.verdict,
        completedAt: new Date()
      }
    })
  ]);
}
