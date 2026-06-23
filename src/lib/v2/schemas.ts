import { z } from "zod";

import {
  MAX_DAILY_IDEAS,
  MAX_IDEAS_PER_PAPER,
  NOVELTY_STATUSES,
  VIABILITY_VERDICTS
} from "@/lib/v2/domain";

const UnitScoreSchema = z.number().min(0).max(1);

export const CitationSchema = z.object({
  sourceType: z.enum(["paper", "related_work", "web", "generated_analysis"]),
  title: z.string().min(1),
  url: z.string().url().or(z.literal("")),
  sourceId: z.string().optional(),
  claim: z.string().min(1),
  confidence: UnitScoreSchema
});

export const IdeaScoresSchema = z.object({
  relevance: UnitScoreSchema,
  significance: UnitScoreSchema,
  originality: UnitScoreSchema,
  feasibility: UnitScoreSchema,
  overall: UnitScoreSchema
});

export const IdeaScoreExplanationsSchema = z.object({
  relevance: z.string().min(1),
  significance: z.string().min(1),
  originality: z.string().min(1),
  feasibility: z.string().min(1),
  overall: z.string().min(1)
});

export const GeneratedIdeaSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  expandedExplanation: z.string().min(1),
  trajectory: z.string().min(1),
  recommended: z.boolean(),
  noveltyStatus: z.enum(NOVELTY_STATUSES),
  scores: IdeaScoresSchema,
  scoreExplanations: IdeaScoreExplanationsSchema,
  risks: z.array(z.string().min(1)).min(1),
  smallestViabilitySprint: z.string().min(1),
  citations: z.array(CitationSchema).min(1)
});

export const GeneratedPaperGroupSchema = z.object({
  source: z.literal("arxiv"),
  sourceId: z.string().min(1),
  title: z.string().min(1),
  abstract: z.string().min(1),
  url: z.string().url(),
  authors: z.array(z.string().min(1)),
  categories: z.array(z.string().min(1)),
  publishedAt: z.string().datetime(),
  whyPaperMatters: z.string().min(1),
  ideas: z.array(GeneratedIdeaSchema).min(1).max(MAX_IDEAS_PER_PAPER)
});

export const GeneratedInboxSchema = z
  .object({
    inboxDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    generatedForUserId: z.string().min(1),
    papers: z.array(GeneratedPaperGroupSchema).min(1)
  })
  .superRefine((value, ctx) => {
    const totalIdeas = value.papers.reduce((sum, paper) => sum + paper.ideas.length, 0);
    if (totalIdeas > MAX_DAILY_IDEAS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Generated inbox contains ${totalIdeas} ideas; maximum is ${MAX_DAILY_IDEAS}`,
        path: ["papers"]
      });
    }
  });

export const InboxGenerationJobInputSchema = z.object({
  jobId: z.string().min(1),
  userId: z.string().min(1),
  inboxDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  profile: z.object({
    fieldPreset: z.string().min(1),
    keywords: z.array(z.string().min(1)),
    constraints: z.array(z.string().min(1)),
    preferredOutputs: z.array(z.string().min(1)),
    arxivQuery: z.string().min(1),
    maxIdeas: z.literal(MAX_DAILY_IDEAS),
    maxIdeasPerPaper: z.literal(MAX_IDEAS_PER_PAPER)
  }),
  candidatePapers: z.array(
    z.object({
      sourceId: z.string().min(1),
      title: z.string().min(1),
      abstract: z.string().min(1),
      url: z.string().url(),
      authors: z.array(z.string().min(1)),
      categories: z.array(z.string().min(1)),
      publishedAt: z.string().datetime()
    })
  )
});

export const ViabilityResultSchema = z.object({
  jobId: z.string().min(1),
  verdict: z.enum(VIABILITY_VERDICTS),
  summary: z.string().min(1),
  feasibility: z.string().min(1),
  noveltyRisk: z.string().min(1),
  minimumExperiment: z.string().min(1),
  blockers: z.array(z.string().min(1)),
  citations: z.array(CitationSchema).min(1)
});

export type GeneratedInbox = z.infer<typeof GeneratedInboxSchema>;
export type GeneratedIdea = z.infer<typeof GeneratedIdeaSchema>;
export type ViabilityResult = z.infer<typeof ViabilityResultSchema>;
