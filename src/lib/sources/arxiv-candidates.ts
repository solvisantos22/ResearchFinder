import { Prisma } from "@prisma/client";

import { fetchArxivPapers } from "@/lib/arxiv/client";
import { prisma } from "@/lib/db";
import { parseJsonField } from "@/lib/seed";

export async function createArxivCandidateBatchForUser(userId: string, inboxDate: string) {
  const source = "arxiv";
  const existing = await findExistingArxivBatch(userId, inboxDate);
  if (existing) return existing;

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
          status: "completed"
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

    return prisma.candidateBatch.findUniqueOrThrow({
      where: {
        userId_inboxDate_source: {
          userId,
          inboxDate,
          source
        }
      },
      include: { candidates: true }
    });
  }
}

export function parseCandidateAuthors(value: string) {
  return parseJsonField<string[]>(value);
}

async function findExistingArxivBatch(userId: string, inboxDate: string) {
  return prisma.candidateBatch.findUnique({
    where: {
      userId_inboxDate_source: {
        userId,
        inboxDate,
        source: "arxiv"
      }
    },
    include: { candidates: true }
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
