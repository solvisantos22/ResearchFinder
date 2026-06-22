import { prisma } from "@/lib/db";
import { fetchArxivPapers } from "@/lib/arxiv/client";
import { generateIdeasForPaper } from "@/lib/ranking/ideaGenerator";
import { scorePaperForProfile, type RankedScore } from "@/lib/ranking/scoring";
import { parseJsonField } from "@/lib/seed";

export type InboxReasoning = {
  whyPaperMatters: string;
  whyIdeaPromising: string;
  whyItMightBeTrap: string;
  smallestSprint: string;
  suggestedDepth: "fast" | "default" | "deep";
  suggestedAutonomy: "low" | "medium" | "high";
};

export function createInboxReasoning(input: {
  title: string;
  score: RankedScore;
  ideaTitle: string;
}): InboxReasoning {
  const normalizedIdeaTitle = input.ideaTitle.toLowerCase();
  const dispatchFriendly = input.score.dispatchLikelihood > 0.75;

  return {
    whyPaperMatters: `${input.title} shows strong paper quality (${input.score.paperQuality.toFixed(2)}) and matches the profile closely enough to merit a closer look.`,
    whyIdeaPromising: `${input.ideaTitle} is the best attached opportunity because it is concrete enough to dispatch into a bounded experiment without adding frontier-scale scope.`,
    whyItMightBeTrap:
      input.score.dispatchLikelihood < 0.55
        ? "The paper may be important but hard to turn into fast evidence, so the first sprint could stall before producing a clear signal."
        : "The idea may be too close to the source paper without a sharper experimental angle, so it needs one explicit stress test or failure case.",
    smallestSprint: `Run the smallest sprint that tests whether ${normalizedIdeaTitle} can produce evidence with one baseline, one stress condition, and a clear pass-fail result.`,
    suggestedDepth: dispatchFriendly ? "default" : "fast",
    suggestedAutonomy: dispatchFriendly ? "medium" : "low"
  };
}

export async function buildDailyInboxForUser(userId: string, inboxDate: string) {
  const profile = await prisma.researchProfile.findUnique({
    where: { userId },
    include: { user: true }
  });

  if (!profile) {
    throw new Error(`No research profile found for ${userId}`);
  }

  const interests = parseJsonField<string[]>(profile.interestsJson);
  const preferredOutputs = parseJsonField<string[]>(profile.preferredOutputsJson);
  const papers = await fetchArxivPapers(profile.arxivQuery, 40);
  const rankedCandidates = papers
    .map((paperInput) => {
      const score = scorePaperForProfile(
        {
          title: paperInput.title,
          abstract: paperInput.abstract,
          categories: paperInput.categories
        },
        {
          interests,
          preferredOutputs,
          rankingWeightsJson: profile.rankingWeightsJson
        }
      );

      const [bestIdeaInput] = generateIdeasForPaper(
        {
          title: paperInput.title,
          abstract: paperInput.abstract,
          categories: paperInput.categories
        },
        {
          interests,
          preferredOutputs
        }
      );

      if (!bestIdeaInput) {
        return null;
      }

      return {
        paperInput,
        score,
        bestIdeaInput,
        reasoning: createInboxReasoning({
          title: paperInput.title,
          score,
          ideaTitle: bestIdeaInput.title
        })
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.score.overall - left.score.overall)
    .slice(0, profile.maxDailyPapers);

  if (rankedCandidates.length === 0) {
    await prisma.inboxItem.deleteMany({
      where: {
        userId,
        inboxDate
      }
    });

    return [];
  }

  return prisma.$transaction(async (tx) => {
    const items = [];
    const retainedPaperIds: string[] = [];

    for (const candidate of rankedCandidates) {
      const paper = await tx.paper.upsert({
        where: { arxivId: candidate.paperInput.arxivId },
        update: {
          title: candidate.paperInput.title,
          abstract: candidate.paperInput.abstract,
          url: candidate.paperInput.url,
          publishedAt: candidate.paperInput.publishedAt,
          arxivUpdatedAt: candidate.paperInput.updatedAt,
          authorsJson: JSON.stringify(candidate.paperInput.authors),
          categoriesJson: JSON.stringify(candidate.paperInput.categories)
        },
        create: {
          arxivId: candidate.paperInput.arxivId,
          title: candidate.paperInput.title,
          abstract: candidate.paperInput.abstract,
          url: candidate.paperInput.url,
          publishedAt: candidate.paperInput.publishedAt,
          arxivUpdatedAt: candidate.paperInput.updatedAt,
          authorsJson: JSON.stringify(candidate.paperInput.authors),
          categoriesJson: JSON.stringify(candidate.paperInput.categories)
        }
      });
      retainedPaperIds.push(paper.id);

      const existingIdea = await tx.idea.findFirst({
        where: {
          paperId: paper.id,
          title: candidate.bestIdeaInput.title
        },
        orderBy: { createdAt: "asc" }
      });

      const bestIdea = existingIdea
        ? await tx.idea.update({
            where: { id: existingIdea.id },
            data: {
              summary: candidate.bestIdeaInput.summary,
              rationale: candidate.bestIdeaInput.rationale,
              approach: candidate.bestIdeaInput.approach,
              risksJson: JSON.stringify(candidate.bestIdeaInput.risks),
              nextStepsJson: JSON.stringify(candidate.bestIdeaInput.nextSteps),
              tagsJson: JSON.stringify(candidate.bestIdeaInput.tags),
              generatedBy: candidate.bestIdeaInput.generatedBy
            }
          })
        : await tx.idea.create({
            data: {
              paperId: paper.id,
              title: candidate.bestIdeaInput.title,
              summary: candidate.bestIdeaInput.summary,
              rationale: candidate.bestIdeaInput.rationale,
              approach: candidate.bestIdeaInput.approach,
              risksJson: JSON.stringify(candidate.bestIdeaInput.risks),
              nextStepsJson: JSON.stringify(candidate.bestIdeaInput.nextSteps),
              tagsJson: JSON.stringify(candidate.bestIdeaInput.tags),
              generatedBy: candidate.bestIdeaInput.generatedBy
            }
          });

      const item = await tx.inboxItem.upsert({
        where: {
          userId_paperId_inboxDate: {
            userId,
            paperId: paper.id,
            inboxDate
          }
        },
        update: {
          bestIdeaId: bestIdea.id,
          overallScore: candidate.score.overall,
          paperQuality: candidate.score.paperQuality,
          projectOpportunity: candidate.score.projectOpportunity,
          dispatchLikelihood: candidate.score.dispatchLikelihood,
          reasoningJson: JSON.stringify(candidate.reasoning)
        },
        create: {
          userId,
          paperId: paper.id,
          bestIdeaId: bestIdea.id,
          inboxDate,
          overallScore: candidate.score.overall,
          paperQuality: candidate.score.paperQuality,
          projectOpportunity: candidate.score.projectOpportunity,
          dispatchLikelihood: candidate.score.dispatchLikelihood,
          reasoningJson: JSON.stringify(candidate.reasoning)
        },
        include: {
          paper: true,
          bestIdea: true
        }
      });

      items.push(item);
    }

    await tx.inboxItem.deleteMany({
      where: {
        userId,
        inboxDate,
        paperId: {
          notIn: retainedPaperIds
        }
      }
    });

    return items.sort((left, right) => right.overallScore - left.overallScore);
  });
}

export async function getInboxItems(userId: string, inboxDate: string) {
  const profile = await prisma.researchProfile.findUnique({
    where: { userId },
    select: { maxDailyPapers: true }
  });

  return prisma.inboxItem.findMany({
    where: {
      userId,
      inboxDate
    },
    orderBy: [{ overallScore: "desc" }],
    take: profile?.maxDailyPapers ?? 10,
    include: {
      paper: true,
      bestIdea: true
    }
  });
}
