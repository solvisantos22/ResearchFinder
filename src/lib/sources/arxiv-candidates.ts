import { Prisma } from "@prisma/client";

import { fetchArxivPapers } from "@/lib/arxiv/client";
import { prisma } from "@/lib/db";
import { parseJsonField } from "@/lib/seed";

// When the newest-N window is entirely already-seen (e.g. weekends/holidays, when
// arXiv announces nothing new), reach this much deeper to surface older unseen papers.
const FALLBACK_MAX_RESULTS = 200;

export async function createArxivCandidateBatchForUser(userId: string, inboxDate: string) {
  const source = "arxiv";
  const existing = await findExistingArxivBatch(userId, inboxDate);
  if (existing) return existing;

  if (await findAnyExistingArxivBatch(userId, inboxDate)) {
    throw new Error("Candidate batch for this user/date is not complete");
  }

  const profile = await prisma.researchProfile.findUniqueOrThrow({ where: { userId } });

  const seenCandidates = await prisma.candidatePaper.findMany({
    where: { batch: { userId } },
    select: { arxivId: true }
  });
  const seenArxivIds = new Set(seenCandidates.map((candidate) => candidate.arxivId));

  const fetchUnseen = async (maxResults: number) =>
    dedupePapersByArxivId(await fetchArxivPapers(profile.arxivQuery, maxResults)).filter(
      (paper) => !seenArxivIds.has(paper.arxivId)
    );

  // Primary: the newest `maxPapersScreened` papers, minus anything already seen.
  let papers = await fetchUnseen(profile.maxPapersScreened);

  // Fallback: if everything new is already seen, reach deeper and take the most
  // recent unseen papers so the inbox still builds (e.g. on weekends). Genuinely
  // empty only if there is nothing unseen anywhere in the deeper window.
  if (papers.length === 0) {
    const deeper = await fetchUnseen(Math.max(FALLBACK_MAX_RESULTS, profile.maxPapersScreened));
    papers = deeper.slice(0, profile.maxPapersScreened);
  }

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
