import { z } from "zod";

import {
  CALIBRATED_NOVELTY_LABELS,
  MAX_DAILY_IDEAS,
  MAX_IDEAS_PER_PAPER,
  NOVELTY_STATUSES,
  RESEARCH_STAGES,
  VIABILITY_VERDICTS
} from "@/lib/v2/domain";

function strictObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object(shape).strict();
}

const NonEmptyTrimmedStringSchema = z.string().trim().min(1);

// Agentic stage outputs are free-form model JSON: the same field that should be a plain string
// is sometimes emitted as a structured object (e.g. a hypothesis as { statement, rationale }).
// Coerce any non-string value to a JSON string so structured-output validation never hard-fails on
// this formatting variance; genuine strings pass through untouched. Used for content fields of the
// stage OUTPUT schemas only (ids, enums, citations and numbers stay strict).
const coerceToString = (value: unknown) =>
  typeof value === "string" || value === null || value === undefined ? value : JSON.stringify(value);
const CoercibleString = z.preprocess(coerceToString, NonEmptyTrimmedStringSchema);
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

const NoveltyScanStatusSchema = z.enum(["completed", "partial", "failed"]);
const NoveltyEvidenceSourceTypeSchema = z.enum([
  "arxiv",
  "scholarly",
  "web",
  "github",
  "generated_analysis"
]);
const NoveltyOverlapLevelSchema = z.enum(["exact", "close", "adjacent", "weak"]);

export const NoveltyEvidenceSchema = strictObject({
  sourceType: NoveltyEvidenceSourceTypeSchema,
  title: NonEmptyTrimmedStringSchema,
  url: RequiredUrlSchema.or(z.literal("")),
  sourceId: NonEmptyTrimmedStringSchema.optional(),
  claim: NonEmptyTrimmedStringSchema,
  overlapLevel: NoveltyOverlapLevelSchema,
  confidence: UnitScoreSchema
});

export const NoveltyScanItemSchema = strictObject({
  generatedIdeaId: NonEmptyTrimmedStringSchema,
  status: NoveltyScanStatusSchema,
  label: z.enum(CALIBRATED_NOVELTY_LABELS),
  confidence: UnitScoreSchema,
  summary: NonEmptyTrimmedStringSchema,
  overlapExplanation: NonEmptyTrimmedStringSchema,
  queries: z.array(NonEmptyTrimmedStringSchema),
  adaptersAttempted: z.array(NonEmptyTrimmedStringSchema),
  adaptersFailed: z.array(NonEmptyTrimmedStringSchema),
  evidence: z.array(NoveltyEvidenceSchema)
}).superRefine((scan, ctx) => {
  if (scan.label !== "not_checked" && scan.evidence.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Novelty scan evidence is required unless label is not_checked",
      path: ["evidence"]
    });
  }
});

export const NoveltyScanResultSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  generatedForUserId: NonEmptyTrimmedStringSchema,
  inboxDate: CalendarDateSchema,
  scans: z.array(NoveltyScanItemSchema).min(1)
});

export const NoveltyScanJobInputSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  userId: NonEmptyTrimmedStringSchema,
  inboxDate: CalendarDateSchema,
  profile: strictObject({
    fieldPreset: NonEmptyTrimmedStringSchema,
    keywords: z.array(NonEmptyTrimmedStringSchema),
    constraints: z.array(NonEmptyTrimmedStringSchema),
    preferredOutputs: z.array(NonEmptyTrimmedStringSchema),
    allowRelatedWorkSearch: z.boolean()
  }),
  ideas: z.array(
    strictObject({
      id: NonEmptyTrimmedStringSchema,
      title: NonEmptyTrimmedStringSchema,
      summary: NonEmptyTrimmedStringSchema,
      expandedExplanation: NonEmptyTrimmedStringSchema,
      trajectory: NonEmptyTrimmedStringSchema,
      smallestSprint: NonEmptyTrimmedStringSchema,
      paper: strictObject({
        id: NonEmptyTrimmedStringSchema,
        arxivId: NonEmptyTrimmedStringSchema,
        title: NonEmptyTrimmedStringSchema,
        abstract: NonEmptyTrimmedStringSchema,
        url: RequiredUrlSchema,
        authors: z.array(NonEmptyTrimmedStringSchema),
        categories: z.array(NonEmptyTrimmedStringSchema),
        publishedAt: z.string().datetime()
      })
    })
  ).min(1)
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

export const ResearchPlanSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: CoercibleString,
  hypotheses: z.array(CoercibleString).min(1),
  experimentalDesign: CoercibleString,
  protocolSteps: z.array(CoercibleString).min(1),
  datasets: z.array(CoercibleString),
  baselines: z.array(CoercibleString),
  metrics: z.array(CoercibleString),
  successCriteria: z.array(CoercibleString).min(1),
  computeEstimate: CoercibleString,
  risks: z.array(CoercibleString),
  citations: z.array(CitationSchema).min(1)
});

export const ResearchPlanJobInputSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  userId: NonEmptyTrimmedStringSchema,
  researchProjectId: NonEmptyTrimmedStringSchema,
  idea: strictObject({
    id: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema,
    expandedExplanation: NonEmptyTrimmedStringSchema,
    trajectory: NonEmptyTrimmedStringSchema,
    smallestSprint: NonEmptyTrimmedStringSchema
  }),
  paper: strictObject({
    id: NonEmptyTrimmedStringSchema,
    arxivId: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    abstract: NonEmptyTrimmedStringSchema,
    url: RequiredUrlSchema,
    authors: z.array(NonEmptyTrimmedStringSchema),
    categories: z.array(NonEmptyTrimmedStringSchema),
    publishedAt: z.string().datetime()
  }),
  viability: strictObject({
    verdict: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema,
    feasibility: NonEmptyTrimmedStringSchema,
    noveltyRisk: NonEmptyTrimmedStringSchema,
    minimumExperiment: NonEmptyTrimmedStringSchema,
    blockers: z.array(NonEmptyTrimmedStringSchema)
  }).nullable(),
  citations: z.array(CitationSchema),
  feedback: NonEmptyTrimmedStringSchema.optional()
});

export const LiteratureReviewSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: CoercibleString,
  relatedWorks: z
    .array(
      strictObject({
        title: CoercibleString,
        summary: CoercibleString,
        relationToProposed: CoercibleString
      })
    )
    .min(1),
  themes: z.array(CoercibleString).min(1),
  gaps: z.array(CoercibleString).min(1),
  positioning: CoercibleString,
  availableResources: z.array(CoercibleString).optional(),
  citations: z.array(CitationSchema).min(1)
});

export const LiteratureJobInputSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  userId: NonEmptyTrimmedStringSchema,
  researchProjectId: NonEmptyTrimmedStringSchema,
  idea: strictObject({
    id: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema,
    expandedExplanation: NonEmptyTrimmedStringSchema,
    trajectory: NonEmptyTrimmedStringSchema,
    smallestSprint: NonEmptyTrimmedStringSchema
  }),
  paper: strictObject({
    id: NonEmptyTrimmedStringSchema,
    arxivId: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    abstract: NonEmptyTrimmedStringSchema,
    url: RequiredUrlSchema,
    authors: z.array(NonEmptyTrimmedStringSchema),
    categories: z.array(NonEmptyTrimmedStringSchema),
    publishedAt: z.string().datetime()
  }),
  plan: strictObject({
    relationToSourcePaper: NonEmptyTrimmedStringSchema,
    hypotheses: z.array(NonEmptyTrimmedStringSchema).min(1),
    experimentalDesign: NonEmptyTrimmedStringSchema,
    metrics: z.array(NonEmptyTrimmedStringSchema)
  }),
  citations: z.array(CitationSchema),
  feedback: NonEmptyTrimmedStringSchema.optional()
});

export const ExperimentResultSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: CoercibleString,
  implementationSummary: CoercibleString,
  environment: CoercibleString,
  hypothesisOutcomes: z
    .array(
      strictObject({
        hypothesis: CoercibleString,
        outcome: z.enum(["supported", "refuted", "inconclusive"]),
        evidence: CoercibleString
      })
    )
    .min(1),
  metrics: z.array(
    strictObject({
      name: CoercibleString,
      value: CoercibleString,
      unit: CoercibleString.optional(),
      baseline: CoercibleString.optional()
    })
  ),
  findings: z.array(CoercibleString).min(1),
  limitations: z.array(CoercibleString),
  artifacts: z.array(
    strictObject({
      path: CoercibleString,
      description: CoercibleString.optional(),
      bytes: z.number().int().nonnegative()
    })
  ),
  logsExcerpt: CoercibleString,
  reproductionSteps: z.array(CoercibleString).min(1),
  verdict: z.enum(["success", "partial", "failed"]),
  summary: CoercibleString,
  citations: z.array(CitationSchema).min(1)
});

export const ExperimentJobInputSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  userId: NonEmptyTrimmedStringSchema,
  researchProjectId: NonEmptyTrimmedStringSchema,
  idea: strictObject({
    id: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema,
    expandedExplanation: NonEmptyTrimmedStringSchema,
    trajectory: NonEmptyTrimmedStringSchema,
    smallestSprint: NonEmptyTrimmedStringSchema
  }),
  paper: strictObject({
    id: NonEmptyTrimmedStringSchema,
    arxivId: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    abstract: NonEmptyTrimmedStringSchema,
    url: RequiredUrlSchema,
    authors: z.array(NonEmptyTrimmedStringSchema),
    categories: z.array(NonEmptyTrimmedStringSchema),
    publishedAt: z.string().datetime()
  }),
  plan: strictObject({
    relationToSourcePaper: NonEmptyTrimmedStringSchema,
    hypotheses: z.array(NonEmptyTrimmedStringSchema).min(1),
    experimentalDesign: NonEmptyTrimmedStringSchema,
    protocolSteps: z.array(NonEmptyTrimmedStringSchema).min(1),
    datasets: z.array(NonEmptyTrimmedStringSchema),
    baselines: z.array(NonEmptyTrimmedStringSchema),
    metrics: z.array(NonEmptyTrimmedStringSchema),
    successCriteria: z.array(NonEmptyTrimmedStringSchema).min(1)
  }),
  literature: strictObject({
    positioning: NonEmptyTrimmedStringSchema,
    gaps: z.array(NonEmptyTrimmedStringSchema).min(1)
  }),
  viability: strictObject({
    verdict: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema,
    feasibility: NonEmptyTrimmedStringSchema,
    noveltyRisk: NonEmptyTrimmedStringSchema,
    minimumExperiment: NonEmptyTrimmedStringSchema,
    blockers: z.array(NonEmptyTrimmedStringSchema)
  }).nullable(),
  citations: z.array(CitationSchema),
  feedback: NonEmptyTrimmedStringSchema.optional()
});

export const AnalysisResultSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: CoercibleString,
  successCriteriaAssessment: z
    .array(
      strictObject({
        criterion: CoercibleString,
        status: z.enum(["met", "partially_met", "not_met", "inconclusive"]),
        evidence: CoercibleString
      })
    )
    .min(1),
  statisticalFindings: z.array(
    strictObject({
      description: CoercibleString,
      method: CoercibleString.optional(),
      value: CoercibleString.optional(),
      interpretation: CoercibleString
    })
  ),
  keyFindings: z.array(CoercibleString).min(1),
  artifacts: z.array(
    strictObject({
      path: CoercibleString,
      caption: CoercibleString,
      kind: z.enum(["figure", "table", "data"]),
      bytes: z.number().int().nonnegative()
    })
  ),
  comparisonToBaselines: CoercibleString,
  threatsToValidity: z.array(CoercibleString),
  recommendedNextSteps: z.array(CoercibleString),
  verdict: z.enum(["supports_hypotheses", "mixed", "refutes_hypotheses", "inconclusive"]),
  summary: CoercibleString,
  citations: z.array(CitationSchema).min(1)
});

export const AnalysisJobInputSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  userId: NonEmptyTrimmedStringSchema,
  researchProjectId: NonEmptyTrimmedStringSchema,
  idea: strictObject({
    id: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema,
    expandedExplanation: NonEmptyTrimmedStringSchema,
    trajectory: NonEmptyTrimmedStringSchema,
    smallestSprint: NonEmptyTrimmedStringSchema
  }),
  paper: strictObject({
    id: NonEmptyTrimmedStringSchema,
    arxivId: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    abstract: NonEmptyTrimmedStringSchema,
    url: RequiredUrlSchema,
    authors: z.array(NonEmptyTrimmedStringSchema),
    categories: z.array(NonEmptyTrimmedStringSchema),
    publishedAt: z.string().datetime()
  }),
  plan: strictObject({
    relationToSourcePaper: NonEmptyTrimmedStringSchema,
    hypotheses: z.array(NonEmptyTrimmedStringSchema).min(1),
    successCriteria: z.array(NonEmptyTrimmedStringSchema).min(1),
    metrics: z.array(NonEmptyTrimmedStringSchema),
    baselines: z.array(NonEmptyTrimmedStringSchema),
    experimentalDesign: NonEmptyTrimmedStringSchema
  }),
  literature: strictObject({
    positioning: NonEmptyTrimmedStringSchema,
    gaps: z.array(NonEmptyTrimmedStringSchema).min(1)
  }),
  experiment: strictObject({
    hypothesisOutcomes: z
      .array(
        strictObject({
          hypothesis: NonEmptyTrimmedStringSchema,
          outcome: z.enum(["supported", "refuted", "inconclusive"]),
          evidence: NonEmptyTrimmedStringSchema
        })
      )
      .min(1),
    metrics: z.array(
      strictObject({
        name: NonEmptyTrimmedStringSchema,
        value: NonEmptyTrimmedStringSchema,
        unit: NonEmptyTrimmedStringSchema.optional(),
        baseline: NonEmptyTrimmedStringSchema.optional()
      })
    ),
    findings: z.array(NonEmptyTrimmedStringSchema).min(1),
    limitations: z.array(NonEmptyTrimmedStringSchema),
    verdict: z.enum(["success", "partial", "failed"]),
    environment: NonEmptyTrimmedStringSchema,
    reproductionSteps: z.array(NonEmptyTrimmedStringSchema).min(1),
    artifacts: z.array(
      strictObject({
        path: NonEmptyTrimmedStringSchema,
        description: NonEmptyTrimmedStringSchema.optional(),
        bytes: z.number().int().nonnegative()
      })
    ),
    logsExcerpt: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema
  }),
  viability: strictObject({
    verdict: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema,
    feasibility: NonEmptyTrimmedStringSchema,
    noveltyRisk: NonEmptyTrimmedStringSchema,
    minimumExperiment: NonEmptyTrimmedStringSchema,
    blockers: z.array(NonEmptyTrimmedStringSchema)
  }).nullable(),
  citations: z.array(CitationSchema),
  feedback: NonEmptyTrimmedStringSchema.optional()
});

export const PaperResultSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: CoercibleString,
  title: CoercibleString,
  abstract: CoercibleString,
  noveltyStatement: CoercibleString,
  sections: z.array(CoercibleString).min(1),
  texPath: CoercibleString,
  pdfPath: CoercibleString,
  compiled: z.boolean(),
  artifacts: z.array(
    strictObject({
      path: CoercibleString,
      caption: CoercibleString,
      kind: z.enum(["figure", "table", "pdf", "tex"]),
      bytes: z.number().int().nonnegative()
    })
  ),
  summary: CoercibleString,
  citations: z.array(CitationSchema).min(1)
});

export const PaperJobInputSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  userId: NonEmptyTrimmedStringSchema,
  researchProjectId: NonEmptyTrimmedStringSchema,
  idea: strictObject({
    id: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema,
    expandedExplanation: NonEmptyTrimmedStringSchema,
    trajectory: NonEmptyTrimmedStringSchema,
    smallestSprint: NonEmptyTrimmedStringSchema
  }),
  paper: strictObject({
    id: NonEmptyTrimmedStringSchema,
    arxivId: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    abstract: NonEmptyTrimmedStringSchema,
    url: RequiredUrlSchema,
    authors: z.array(NonEmptyTrimmedStringSchema),
    categories: z.array(NonEmptyTrimmedStringSchema),
    publishedAt: z.string().datetime()
  }),
  plan: strictObject({
    relationToSourcePaper: NonEmptyTrimmedStringSchema,
    hypotheses: z.array(NonEmptyTrimmedStringSchema).min(1),
    successCriteria: z.array(NonEmptyTrimmedStringSchema).min(1),
    metrics: z.array(NonEmptyTrimmedStringSchema),
    baselines: z.array(NonEmptyTrimmedStringSchema),
    experimentalDesign: NonEmptyTrimmedStringSchema
  }),
  literature: strictObject({
    positioning: NonEmptyTrimmedStringSchema,
    gaps: z.array(NonEmptyTrimmedStringSchema).min(1)
  }),
  experiment: strictObject({
    summary: NonEmptyTrimmedStringSchema,
    verdict: NonEmptyTrimmedStringSchema,
    findings: z.array(NonEmptyTrimmedStringSchema).min(1)
  }),
  analysis: strictObject({
    summary: NonEmptyTrimmedStringSchema,
    verdict: NonEmptyTrimmedStringSchema,
    keyFindings: z.array(NonEmptyTrimmedStringSchema).min(1),
    comparisonToBaselines: NonEmptyTrimmedStringSchema
  }),
  citations: z.array(CitationSchema),
  feedback: NonEmptyTrimmedStringSchema.optional()
});

const CriticScorecardEntrySchema = strictObject({
  criterion: NonEmptyTrimmedStringSchema,
  pass: z.boolean(),
  note: NonEmptyTrimmedStringSchema
});

export const CriticVerdictSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  stageType: z.enum(RESEARCH_STAGES),
  verdict: z.enum(["PASS", "REDO", "BACKTRACK"]),
  scorecard: z.array(CriticScorecardEntrySchema).min(1),
  targetStage: z.enum(RESEARCH_STAGES).optional(),
  feedback: NonEmptyTrimmedStringSchema.optional()
}).superRefine((value, ctx) => {
  if (value.verdict === "BACKTRACK") {
    if (!value.targetStage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "BACKTRACK verdict requires targetStage",
        path: ["targetStage"]
      });
    } else {
      const stageIndex = RESEARCH_STAGES.indexOf(value.stageType);
      const targetIndex = RESEARCH_STAGES.indexOf(value.targetStage);
      if (targetIndex >= stageIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "BACKTRACK targetStage must be a stage strictly before stageType",
          path: ["targetStage"]
        });
      }
    }
  } else if (value.targetStage !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "targetStage is only allowed on a BACKTRACK verdict",
      path: ["targetStage"]
    });
  }

  if (value.verdict !== "PASS" && !value.feedback) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "REDO and BACKTRACK verdicts require feedback",
      path: ["feedback"]
    });
  }
});

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
export type ResearchPlanJobInput = z.infer<typeof ResearchPlanJobInputSchema>;
export type LiteratureReview = z.infer<typeof LiteratureReviewSchema>;
export type LiteratureJobInput = z.infer<typeof LiteratureJobInputSchema>;
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;
export type ExperimentJobInput = z.infer<typeof ExperimentJobInputSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type AnalysisJobInput = z.infer<typeof AnalysisJobInputSchema>;
export type PaperResult = z.infer<typeof PaperResultSchema>;
export type PaperJobInput = z.infer<typeof PaperJobInputSchema>;

export type Citation = z.infer<typeof CitationSchema>;
export type GeneratedInbox = z.infer<typeof GeneratedInboxSchema>;
export type GeneratedPaperGroup = z.infer<typeof GeneratedPaperGroupSchema>;
export type GeneratedIdea = z.infer<typeof GeneratedIdeaSchema>;
export type InboxGenerationJobInput = z.infer<typeof InboxGenerationJobInputSchema>;
export type NoveltyScanResult = z.infer<typeof NoveltyScanResultSchema>;
export type NoveltyScanJobInput = z.infer<typeof NoveltyScanJobInputSchema>;
export type ViabilityResult = z.infer<typeof ViabilityResultSchema>;
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;
