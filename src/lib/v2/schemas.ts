import { z } from "zod";

import {
  MAX_DAILY_IDEAS,
  MAX_IDEAS_PER_PAPER,
  NOVELTY_STATUSES,
  VIABILITY_VERDICTS
} from "@/lib/v2/domain";

function strictObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object(shape).strict();
}

const NonEmptyTrimmedStringSchema = z.string().trim().min(1);
const RequiredUrlSchema = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Expected an HTTP(S) URL");
const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Expected a valid calendar date");
const UnitScoreSchema = z.number().min(0).max(1);

const CitationFields = {
  title: NonEmptyTrimmedStringSchema,
  sourceId: NonEmptyTrimmedStringSchema.optional(),
  claim: NonEmptyTrimmedStringSchema,
  confidence: UnitScoreSchema
};

export const CitationSchema = z.discriminatedUnion("sourceType", [
  strictObject({
    sourceType: z.literal("paper"),
    url: RequiredUrlSchema,
    ...CitationFields
  }),
  strictObject({
    sourceType: z.literal("related_work"),
    url: RequiredUrlSchema,
    ...CitationFields
  }),
  strictObject({
    sourceType: z.literal("web"),
    url: RequiredUrlSchema,
    ...CitationFields
  }),
  strictObject({
    sourceType: z.literal("generated_analysis"),
    url: RequiredUrlSchema.or(z.literal("")),
    ...CitationFields
  })
]);

export const IdeaScoresSchema = strictObject({
  relevance: UnitScoreSchema,
  significance: UnitScoreSchema,
  originality: UnitScoreSchema,
  feasibility: UnitScoreSchema,
  overall: UnitScoreSchema
});

export const IdeaScoreExplanationsSchema = strictObject({
  relevance: NonEmptyTrimmedStringSchema,
  significance: NonEmptyTrimmedStringSchema,
  originality: NonEmptyTrimmedStringSchema,
  feasibility: NonEmptyTrimmedStringSchema,
  overall: NonEmptyTrimmedStringSchema
});

export const GeneratedIdeaSchema = strictObject({
  title: NonEmptyTrimmedStringSchema,
  summary: NonEmptyTrimmedStringSchema,
  expandedExplanation: NonEmptyTrimmedStringSchema,
  trajectory: NonEmptyTrimmedStringSchema,
  recommended: z.boolean(),
  noveltyStatus: z.enum(NOVELTY_STATUSES),
  scores: IdeaScoresSchema,
  scoreExplanations: IdeaScoreExplanationsSchema,
  risks: z.array(NonEmptyTrimmedStringSchema).min(1),
  smallestViabilitySprint: NonEmptyTrimmedStringSchema,
  citations: z.array(CitationSchema).min(1)
});

export const GeneratedPaperGroupSchema = strictObject({
  source: z.literal("arxiv"),
  sourceId: NonEmptyTrimmedStringSchema,
  title: NonEmptyTrimmedStringSchema,
  abstract: NonEmptyTrimmedStringSchema,
  url: RequiredUrlSchema,
  authors: z.array(NonEmptyTrimmedStringSchema).min(1),
  categories: z.array(NonEmptyTrimmedStringSchema).min(1),
  publishedAt: z.string().datetime(),
  whyPaperMatters: NonEmptyTrimmedStringSchema,
  ideas: z.array(GeneratedIdeaSchema).min(1).max(MAX_IDEAS_PER_PAPER)
}).superRefine((paper, ctx) => {
  paper.ideas.forEach((idea, ideaIndex) => {
    const citesSourcePaper = idea.citations.some(
      (citation) =>
        citation.sourceType === "paper" &&
        citation.sourceId === paper.sourceId &&
        citation.url === paper.url
    );

    if (!citesSourcePaper) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each generated idea must cite the source arXiv paper",
        path: ["ideas", ideaIndex, "citations"]
      });
    }
  });
});

export const GeneratedInboxSchema = strictObject({
  inboxDate: CalendarDateSchema,
  generatedForUserId: NonEmptyTrimmedStringSchema,
  papers: z.array(GeneratedPaperGroupSchema).min(1)
}).superRefine((value, ctx) => {
  const totalIdeas = value.papers.reduce((sum, paper) => sum + paper.ideas.length, 0);
  if (totalIdeas > MAX_DAILY_IDEAS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Generated inbox contains ${totalIdeas} ideas; maximum is ${MAX_DAILY_IDEAS}`,
      path: ["papers"]
    });
  }

  const seenSourceIds = new Map<string, number>();
  value.papers.forEach((paper, paperIndex) => {
    const firstIndex = seenSourceIds.get(paper.sourceId);
    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Generated inbox repeats sourceId ${paper.sourceId}; each source paper must appear once`,
        path: ["papers", paperIndex, "sourceId"]
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Generated inbox repeats sourceId ${paper.sourceId}; each source paper must appear once`,
        path: ["papers", firstIndex, "sourceId"]
      });
      return;
    }

    seenSourceIds.set(paper.sourceId, paperIndex);
  });
});

export const InboxGenerationJobInputSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  userId: NonEmptyTrimmedStringSchema,
  inboxDate: CalendarDateSchema,
  profile: strictObject({
    fieldPreset: NonEmptyTrimmedStringSchema,
    keywords: z.array(NonEmptyTrimmedStringSchema),
    constraints: z.array(NonEmptyTrimmedStringSchema),
    preferredOutputs: z.array(NonEmptyTrimmedStringSchema),
    arxivQuery: NonEmptyTrimmedStringSchema,
    maxIdeas: z.literal(MAX_DAILY_IDEAS),
    maxIdeasPerPaper: z.literal(MAX_IDEAS_PER_PAPER)
  }),
  candidatePapers: z.array(
    strictObject({
      sourceId: NonEmptyTrimmedStringSchema,
      title: NonEmptyTrimmedStringSchema,
      abstract: NonEmptyTrimmedStringSchema,
      url: RequiredUrlSchema,
      authors: z.array(NonEmptyTrimmedStringSchema).min(1),
      categories: z.array(NonEmptyTrimmedStringSchema).min(1),
      publishedAt: z.string().datetime()
    })
  )
});

export const ViabilityResultSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  verdict: z.enum(VIABILITY_VERDICTS),
  summary: NonEmptyTrimmedStringSchema,
  feasibility: NonEmptyTrimmedStringSchema,
  noveltyRisk: NonEmptyTrimmedStringSchema,
  minimumExperiment: NonEmptyTrimmedStringSchema,
  blockers: z.array(NonEmptyTrimmedStringSchema),
  citations: z.array(CitationSchema).min(1)
});

export type Citation = z.infer<typeof CitationSchema>;
export type GeneratedInbox = z.infer<typeof GeneratedInboxSchema>;
export type GeneratedPaperGroup = z.infer<typeof GeneratedPaperGroupSchema>;
export type GeneratedIdea = z.infer<typeof GeneratedIdeaSchema>;
export type InboxGenerationJobInput = z.infer<typeof InboxGenerationJobInputSchema>;
export type ViabilityResult = z.infer<typeof ViabilityResultSchema>;
