import { prisma } from "@/lib/db";
import { GeneratedInboxSchema, type GeneratedInbox } from "@/lib/v2/schemas";

const MAX_CLAIM_ATTEMPTS = 3;

export async function createInboxGenerationJob(input: {
  userId: string;
  candidateBatchId: string;
  inboxDate: string;
}) {
  return prisma.$transaction(async (tx) => {
    const candidateBatch = await tx.candidateBatch.findFirst({
      where: {
        id: input.candidateBatchId,
        userId: input.userId,
        inboxDate: input.inboxDate
      },
      select: { completedAt: true, id: true, status: true }
    });

    if (!candidateBatch) {
      throw new Error("Candidate batch does not belong to this user/date");
    }

    if (candidateBatch.status !== "completed" || !candidateBatch.completedAt) {
      throw new Error("Candidate batch is not complete");
    }

    return tx.inboxGenerationJob.upsert({
      where: {
        userId_candidateBatchId_inboxDate: {
          userId: input.userId,
          candidateBatchId: input.candidateBatchId,
          inboxDate: input.inboxDate
        }
      },
      update: {},
      create: {
        userId: input.userId,
        candidateBatchId: input.candidateBatchId,
        inboxDate: input.inboxDate,
        status: "queued",
        inputJson: JSON.stringify({ candidateBatchId: input.candidateBatchId })
      }
    });
  });
}

export async function claimNextInboxGenerationJob(input: { userId: string; workerId: string }) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const job = await prisma.inboxGenerationJob.findFirst({
      where: {
        userId: input.userId,
        status: "queued"
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (!job) return null;

    const claim = await prisma.inboxGenerationJob.updateMany({
      where: {
        id: job.id,
        status: "queued",
        userId: input.userId
      },
      data: {
        status: "running",
        claimedByWorkerId: input.workerId,
        startedAt: new Date()
      }
    });

    if (claim.count !== 1) continue;

    return prisma.inboxGenerationJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        candidateBatch: {
          include: {
            candidates: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }]
            }
          }
        },
        user: {
          include: { profile: true }
        }
      }
    });
  }

  return null;
}

export async function completeInboxGenerationJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  const parsed = GeneratedInboxSchema.parse(input.output);

  const job = await prisma.inboxGenerationJob.findFirstOrThrow({
    where: {
      id: input.jobId,
      claimedByWorkerId: input.workerId,
      status: "running"
    }
  });

  if (parsed.generatedForUserId !== job.userId || parsed.inboxDate !== job.inboxDate) {
    throw new Error("Generated inbox output does not match claimed job user/date");
  }

  await persistGeneratedInbox(parsed, job.id);

  return prisma.inboxGenerationJob.update({
    where: { id: job.id },
    data: {
      status: "completed",
      outputJson: JSON.stringify(parsed),
      completedAt: new Date()
    }
  });
}

async function persistGeneratedInbox(inbox: GeneratedInbox, jobId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.generatedIdea.deleteMany({
      where: {
        userId: inbox.generatedForUserId,
        inboxDate: inbox.inboxDate
      }
    });

    for (const paperGroup of inbox.papers) {
      const paper = await tx.paper.upsert({
        where: { arxivId: paperGroup.sourceId },
        update: {
          title: paperGroup.title,
          abstract: paperGroup.abstract,
          url: paperGroup.url,
          publishedAt: new Date(paperGroup.publishedAt),
          arxivUpdatedAt: new Date(paperGroup.publishedAt),
          authorsJson: JSON.stringify(paperGroup.authors),
          categoriesJson: JSON.stringify(paperGroup.categories)
        },
        create: {
          arxivId: paperGroup.sourceId,
          title: paperGroup.title,
          abstract: paperGroup.abstract,
          url: paperGroup.url,
          publishedAt: new Date(paperGroup.publishedAt),
          arxivUpdatedAt: new Date(paperGroup.publishedAt),
          authorsJson: JSON.stringify(paperGroup.authors),
          categoriesJson: JSON.stringify(paperGroup.categories)
        }
      });

      for (const ideaInput of paperGroup.ideas) {
        const idea = await tx.generatedIdea.create({
          data: {
            userId: inbox.generatedForUserId,
            paperId: paper.id,
            inboxGenerationJobId: jobId,
            inboxDate: inbox.inboxDate,
            title: ideaInput.title,
            summary: ideaInput.summary,
            expandedExplanation: ideaInput.expandedExplanation,
            trajectory: ideaInput.trajectory,
            recommended: ideaInput.recommended,
            noveltyStatus: ideaInput.noveltyStatus,
            relevanceScore: ideaInput.scores.relevance,
            significanceScore: ideaInput.scores.significance,
            originalityScore: ideaInput.scores.originality,
            feasibilityScore: ideaInput.scores.feasibility,
            overallScore: ideaInput.scores.overall,
            scoreExplanationsJson: JSON.stringify(ideaInput.scoreExplanations),
            risksJson: JSON.stringify(ideaInput.risks),
            smallestSprint: ideaInput.smallestViabilitySprint,
            generatedBy: "codex"
          }
        });

        await tx.ideaCitation.createMany({
          data: ideaInput.citations.map((citation) => ({
            generatedIdeaId: idea.id,
            sourceType: citation.sourceType,
            title: citation.title,
            url: citation.url,
            sourceId: citation.sourceId,
            claim: citation.claim,
            confidence: citation.confidence
          }))
        });
      }
    }
  });
}

export async function getGeneratedInboxState(userId: string, inboxDate: string) {
  const ideas = await prisma.generatedIdea.findMany({
    where: { userId, inboxDate },
    orderBy: [{ overallScore: "desc" }],
    include: {
      paper: true,
      citations: true
    }
  });

  if (ideas.length > 0) {
    return { status: "ready" as const, ideas };
  }

  const latestJob = await prisma.inboxGenerationJob.findFirst({
    where: { userId, inboxDate },
    orderBy: { createdAt: "desc" }
  });

  if (!latestJob) return { status: "pending" as const, ideas: [] };
  if (latestJob.status === "failed") return { status: "failed" as const, ideas: [] };
  return {
    status: latestJob.status as "queued" | "running" | "completed" | "timed_out",
    ideas: []
  };
}
