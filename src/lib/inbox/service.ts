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

  const items = [];

  for (const paperInput of papers) {
    const paper = await prisma.paper.upsert({
      where: { arxivId: paperInput.arxivId },
      update: {
        title: paperInput.title,
        abstract: paperInput.abstract,
        url: paperInput.url,
        publishedAt: paperInput.publishedAt,
        arxivUpdatedAt: paperInput.updatedAt,
        authorsJson: JSON.stringify(paperInput.authors),
        categoriesJson: JSON.stringify(paperInput.categories)
      },
      create: {
        arxivId: paperInput.arxivId,
        title: paperInput.title,
        abstract: paperInput.abstract,
        url: paperInput.url,
        publishedAt: paperInput.publishedAt,
        arxivUpdatedAt: paperInput.updatedAt,
        authorsJson: JSON.stringify(paperInput.authors),
        categoriesJson: JSON.stringify(paperInput.categories)
      }
    });

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

    const existingIdea = await prisma.idea.findFirst({
      where: {
        paperId: paper.id,
        title: bestIdeaInput.title
      },
      orderBy: { createdAt: "asc" }
    });

    const bestIdea = existingIdea
      ? await prisma.idea.update({
          where: { id: existingIdea.id },
          data: {
            summary: bestIdeaInput.summary,
            rationale: bestIdeaInput.rationale,
            approach: bestIdeaInput.approach,
            risksJson: JSON.stringify(bestIdeaInput.risks),
            nextStepsJson: JSON.stringify(bestIdeaInput.nextSteps),
            tagsJson: JSON.stringify(bestIdeaInput.tags),
            generatedBy: bestIdeaInput.generatedBy
          }
        })
      : await prisma.idea.create({
          data: {
            paperId: paper.id,
            title: bestIdeaInput.title,
            summary: bestIdeaInput.summary,
            rationale: bestIdeaInput.rationale,
            approach: bestIdeaInput.approach,
            risksJson: JSON.stringify(bestIdeaInput.risks),
            nextStepsJson: JSON.stringify(bestIdeaInput.nextSteps),
            tagsJson: JSON.stringify(bestIdeaInput.tags),
            generatedBy: bestIdeaInput.generatedBy
          }
        });

    const reasoning = createInboxReasoning({
      title: paperInput.title,
      score,
      ideaTitle: bestIdea.title
    });

    const item = await prisma.inboxItem.upsert({
      where: {
        userId_paperId_inboxDate: {
          userId,
          paperId: paper.id,
          inboxDate
        }
      },
      update: {
        bestIdeaId: bestIdea.id,
        overallScore: score.overall,
        paperQuality: score.paperQuality,
        projectOpportunity: score.projectOpportunity,
        dispatchLikelihood: score.dispatchLikelihood,
        reasoningJson: JSON.stringify(reasoning)
      },
      create: {
        userId,
        paperId: paper.id,
        bestIdeaId: bestIdea.id,
        inboxDate,
        overallScore: score.overall,
        paperQuality: score.paperQuality,
        projectOpportunity: score.projectOpportunity,
        dispatchLikelihood: score.dispatchLikelihood,
        reasoningJson: JSON.stringify(reasoning)
      },
      include: {
        paper: true,
        bestIdea: true
      }
    });

    items.push(item);
  }

  return items
    .sort((left, right) => right.overallScore - left.overallScore)
    .slice(0, profile.maxDailyPapers);
}

export async function getInboxItems(userId: string, inboxDate: string) {
  return prisma.inboxItem.findMany({
    where: {
      userId,
      inboxDate
    },
    orderBy: [{ overallScore: "desc" }],
    take: 10,
    include: {
      paper: true,
      bestIdea: true
    }
  });
}
