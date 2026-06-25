import type { CandidatePaper, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";
import { createNoveltyScanJobForInboxGeneration } from "@/lib/jobs/novelty-scan";
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
      select: {
        completedAt: true,
        id: true,
        status: true,
        _count: {
          select: { candidates: true }
        }
      }
    });

    if (!candidateBatch) {
      throw new Error("Candidate batch does not belong to this user/date");
    }

    if (candidateBatch.status !== "completed" || !candidateBatch.completedAt) {
      throw new Error("Candidate batch is not complete");
    }

    if (candidateBatch._count.candidates === 0) {
      throw new Error("Candidate batch has no papers for inbox generation");
    }

    await tx.inboxGenerationJob.updateMany({
      where: {
        userId: input.userId,
        candidateBatchId: input.candidateBatchId,
        inboxDate: input.inboxDate,
        OR: [
          { status: "failed" },
          { status: "running", startedAt: { lte: staleRunningJobStartedBefore() } }
        ]
      },
      data: {
        status: "queued",
        claimedByWorkerId: null,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        outputJson: null,
        inputJson: JSON.stringify({ candidateBatchId: input.candidateBatchId })
      }
    });

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
    const staleStartedBefore = staleRunningJobStartedBefore();
    const job = await prisma.inboxGenerationJob.findFirst({
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

    const claim = await prisma.inboxGenerationJob.updateMany({
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

  const completedJob = await prisma.$transaction(async (tx) => {
    const job = await tx.inboxGenerationJob.findFirstOrThrow({
      where: {
        id: input.jobId,
        claimedByWorkerId: input.workerId,
        status: "running"
      },
      include: {
        candidateBatch: {
          include: {
            candidates: true
          }
        }
      }
    });

    if (parsed.generatedForUserId !== job.userId || parsed.inboxDate !== job.inboxDate) {
      throw new Error("Generated inbox output does not match claimed job user/date");
    }

    const candidatesByArxivId = new Map(
      job.candidateBatch.candidates.map((candidate) => [candidate.arxivId, candidate])
    );

    for (const paperGroup of parsed.papers) {
      const candidate = candidatesByArxivId.get(paperGroup.sourceId);
      if (!candidate) {
        throw new Error("Generated inbox includes paper outside claimed candidate batch");
      }
      assertGeneratedPaperMatchesCandidate(paperGroup, candidate);
    }

    await persistGeneratedInbox(tx, parsed, job.id, candidatesByArxivId);

    const completion = await tx.inboxGenerationJob.updateMany({
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

    if (completion.count !== 1) {
      throw new Error("Inbox generation job is no longer running");
    }

    return tx.inboxGenerationJob.findUniqueOrThrow({
      where: { id: job.id }
    });
  });

  await createNoveltyScanJobForInboxGeneration({
    userId: completedJob.userId,
    inboxGenerationJobId: completedJob.id,
    inboxDate: completedJob.inboxDate
  });

  return completedJob;
}

function assertGeneratedPaperMatchesCandidate(
  paperGroup: GeneratedInbox["papers"][number],
  candidate: CandidatePaper
) {
  if (paperGroup.url !== candidate.url) {
    throw new Error("Generated inbox source paper metadata does not match claimed candidate batch");
  }

  for (const idea of paperGroup.ideas) {
    const invalidSourceCitation = idea.citations.some(
      (citation) =>
        citation.sourceType === "paper" &&
        (citation.sourceId !== candidate.arxivId || citation.url !== candidate.url)
    );

    if (invalidSourceCitation) {
      throw new Error("Generated inbox source paper metadata does not match claimed candidate batch");
    }
  }
}

async function persistGeneratedInbox(
  tx: Prisma.TransactionClient,
  inbox: GeneratedInbox,
  jobId: string,
  candidatesByArxivId: Map<string, CandidatePaper>
) {
  await tx.generatedIdea.deleteMany({
    where: {
      userId: inbox.generatedForUserId,
      inboxDate: inbox.inboxDate
    }
  });

  for (const paperGroup of inbox.papers) {
    const candidate = candidatesByArxivId.get(paperGroup.sourceId);
    if (!candidate) {
      throw new Error("Generated inbox includes paper outside claimed candidate batch");
    }

    const paper = await tx.paper.upsert({
      where: { arxivId: candidate.arxivId },
      update: {
        title: candidate.title,
        abstract: candidate.abstract,
        url: candidate.url,
        publishedAt: candidate.publishedAt,
        arxivUpdatedAt: candidate.publishedAt,
        authorsJson: candidate.authorsJson,
        categoriesJson: candidate.categoriesJson
      },
      create: {
        arxivId: candidate.arxivId,
        title: candidate.title,
        abstract: candidate.abstract,
        url: candidate.url,
        publishedAt: candidate.publishedAt,
        arxivUpdatedAt: candidate.publishedAt,
        authorsJson: candidate.authorsJson,
        categoriesJson: candidate.categoriesJson
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
}

export async function listInboxDatesForUser(userId: string): Promise<string[]> {
  const [ideaDates, jobDates] = await Promise.all([
    prisma.generatedIdea.findMany({
      where: { userId },
      distinct: ["inboxDate"],
      select: { inboxDate: true }
    }),
    prisma.inboxGenerationJob.findMany({
      where: { userId },
      distinct: ["inboxDate"],
      select: { inboxDate: true }
    })
  ]);

  const dates = new Set<string>([
    ...ideaDates.map((row) => row.inboxDate),
    ...jobDates.map((row) => row.inboxDate)
  ]);

  return Array.from(dates).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
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
