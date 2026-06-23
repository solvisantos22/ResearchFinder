import { Prisma } from "@prisma/client";

import { fetchArxivPapers } from "@/lib/arxiv/client";
import { prisma } from "@/lib/db";
import { parseJsonField } from "@/lib/seed";

export async function createArxivCandidateBatchForUser(userId: string, inboxDate: string) {
  const source = "arxiv";
  const existing = await findExistingArxivBatch(userId, inboxDate);
  if (existing) return existing;

  if (await findAnyExistingArxivBatch(userId, inboxDate)) {
    throw new Error("Candidate batch for this user/date is not complete");
  }

  const profile = await prisma.researchProfile.findUniqueOrThrow({ where: { userId } });
  const papers = dedupePapersByArxivId(
    await fetchArxivPapers(profile.arxivQuery, profile.maxPapersScreened)
  );

  try {
    return await prisma.$transaction(async (tx) => {
      const batch = await tx.candidateBatch.create({
        data: {
          userId,
          inboxDate,
          source,
          query: profile.arxivQuery,
          status: "completed",
          completedAt: new Date()
        }
      });

      await tx.candidatePaper.createMany({
        data: papers.map((paper) => ({
          batchId: batch.id,
          arxivId: paper.arxivId,
          title: paper.title,
          abstract: paper.abstract,
          url: paper.url,
          publishedAt: paper.publishedAt,
          authorsJson: JSON.stringify(paper.authors),
          categoriesJson: JSON.stringify(paper.categories),
          rawJson: JSON.stringify(paper)
        }))
      });

      return tx.candidateBatch.findUniqueOrThrow({
        where: { id: batch.id },
        include: { candidates: true }
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const racedBatch = await prisma.candidateBatch.findUniqueOrThrow({
      where: {
        userId_inboxDate_source: {
          userId,
          inboxDate,
          source
        }
      },
      include: { candidates: true }
    });

    if (!isCompletedBatch(racedBatch)) {
      throw new Error("Candidate batch for this user/date is not complete");
    }

    return racedBatch;
  }
}

export function parseCandidateAuthors(value: string) {
  return parseJsonField<string[]>(value);
}

async function findExistingArxivBatch(userId: string, inboxDate: string) {
  return prisma.candidateBatch.findFirst({
    where: {
      userId,
      inboxDate,
      source: "arxiv",
      status: "completed",
      completedAt: { not: null }
    },
    include: { candidates: true }
  });
}

async function findAnyExistingArxivBatch(userId: string, inboxDate: string) {
  return prisma.candidateBatch.findUnique({
    where: {
      userId_inboxDate_source: {
        userId,
        inboxDate,
        source: "arxiv"
      }
    },
    select: { id: true }
  });
}

function dedupePapersByArxivId<T extends { arxivId: string }>(papers: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const paper of papers) {
    if (seen.has(paper.arxivId)) continue;
    seen.add(paper.arxivId);
    deduped.push(paper);
  }

  return deduped;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isCompletedBatch(batch: { completedAt: Date | null; status: string }) {
  return batch.status === "completed" && batch.completedAt !== null;
}
