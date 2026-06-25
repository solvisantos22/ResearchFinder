import { prisma } from "@/lib/db";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";
import { NoveltyScanResultSchema } from "@/lib/v2/schemas";

const MAX_CLAIM_ATTEMPTS = 3;

export async function createNoveltyScanJobForInboxGeneration(input: {
  userId: string;
  inboxGenerationJobId: string;
  inboxDate: string;
}) {
  return prisma.inboxNoveltyScanJob.upsert({
    where: {
      userId_inboxGenerationJobId_inboxDate: {
        userId: input.userId,
        inboxGenerationJobId: input.inboxGenerationJobId,
        inboxDate: input.inboxDate
      }
    },
    update: {
      status: "queued",
      claimedByWorkerId: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      outputJson: null
    },
    create: {
      userId: input.userId,
      inboxGenerationJobId: input.inboxGenerationJobId,
      inboxDate: input.inboxDate,
      status: "queued",
      inputJson: JSON.stringify({
        inboxGenerationJobId: input.inboxGenerationJobId
      })
    }
  });
}

export async function claimNextNoveltyScanJob(input: { userId: string; workerId: string }) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const staleStartedBefore = staleRunningJobStartedBefore();
    const job = await prisma.inboxNoveltyScanJob.findFirst({
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

    const claim = await prisma.inboxNoveltyScanJob.updateMany({
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

    return prisma.inboxNoveltyScanJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        user: { include: { profile: true } },
        inboxGenerationJob: {
          include: {
            generatedIdeas: {
              include: {
                paper: true,
                citations: true
              },
              orderBy: [{ overallScore: "desc" }, { id: "asc" }]
            }
          }
        }
      }
    });
  }

  return null;
}

export async function completeNoveltyScanJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  const parsed = NoveltyScanResultSchema.parse(input.output);

  return prisma.$transaction(async (tx) => {
    const job = await tx.inboxNoveltyScanJob.findFirstOrThrow({
      where: {
        id: input.jobId,
        claimedByWorkerId: input.workerId,
        status: "running"
      },
      include: {
        inboxGenerationJob: {
          include: {
            generatedIdeas: { select: { id: true } }
          }
        }
      }
    });

    if (parsed.jobId !== job.id) {
      throw new Error("Novelty scan output does not match completed job id");
    }
    if (parsed.generatedForUserId !== job.userId || parsed.inboxDate !== job.inboxDate) {
      throw new Error("Novelty scan output does not match claimed job user/date");
    }

    const validIdeaIds = new Set(job.inboxGenerationJob.generatedIdeas.map((idea) => idea.id));
    for (const scan of parsed.scans) {
      if (!validIdeaIds.has(scan.generatedIdeaId)) {
        throw new Error("Novelty scan includes idea outside claimed inbox job");
      }
    }

    await tx.noveltyScan.deleteMany({
      where: {
        generatedIdeaId: { in: parsed.scans.map((scan) => scan.generatedIdeaId) },
        inboxNoveltyScanJobId: job.id
      }
    });

    for (const scanInput of parsed.scans) {
      const scan = await tx.noveltyScan.create({
        data: {
          generatedIdeaId: scanInput.generatedIdeaId,
          inboxNoveltyScanJobId: job.id,
          status: scanInput.status,
          label: scanInput.label,
          confidence: scanInput.confidence,
          summary: scanInput.summary,
          overlapExplanation: scanInput.overlapExplanation,
          queriesJson: JSON.stringify(scanInput.queries),
          adaptersAttemptedJson: JSON.stringify(scanInput.adaptersAttempted),
          adaptersFailedJson: JSON.stringify(scanInput.adaptersFailed)
        }
      });

      await tx.noveltyEvidence.createMany({
        data: scanInput.evidence.map((evidence) => ({
          scanId: scan.id,
          sourceType: evidence.sourceType,
          title: evidence.title,
          url: evidence.url,
          sourceId: evidence.sourceId,
          claim: evidence.claim,
          overlapLevel: evidence.overlapLevel,
          confidence: evidence.confidence
        }))
      });

      await tx.generatedIdea.update({
        where: { id: scanInput.generatedIdeaId },
        data: { noveltyStatus: scanInput.label }
      });
    }

    await tx.inboxNoveltyScanJob.updateMany({
      where: {
        id: job.id,
        claimedByWorkerId: input.workerId,
        status: "running"
      },
      data: {
        status: "completed",
        outputJson: JSON.stringify(parsed),
        completedAt: new Date()
      }
    });
  });
}
