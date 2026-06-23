import { fetchArxivPapers } from "@/lib/arxiv/client";
import { prisma } from "@/lib/db";
import { parseJsonField } from "@/lib/seed";

export async function createArxivCandidateBatchForUser(userId: string, inboxDate: string) {
  const profile = await prisma.researchProfile.findUniqueOrThrow({ where: { userId } });
  const papers = await fetchArxivPapers(profile.arxivQuery, profile.maxPapersScreened);

  return prisma.$transaction(async (tx) => {
    const batch = await tx.candidateBatch.create({
      data: {
        userId,
        inboxDate,
        source: "arxiv",
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
      })),
      skipDuplicates: true
    });

    return tx.candidateBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { candidates: true }
    });
  });
}

export function parseCandidateAuthors(value: string) {
  return parseJsonField<string[]>(value);
}
