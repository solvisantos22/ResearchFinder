# Analysis Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 4th pipeline stage (`analysis`) — an agentic full-access Codex run that reads the experiment's raw workspace outputs, computes statistics, generates figures/tables locally, and produces a structured `AnalysisResultSchema` interpretation; experiment then advances to analysis and analysis becomes the new terminal stage (`analysis_ready`).

**Architecture:** Mirrors the existing experiment stage exactly (agentic `runCodexAgentic` run, workspace, 60s heartbeat, abort, no timeout). The generic `ResearchStageJob`/`ResearchStageArtifact` registry means the only wiring is: schemas, registry/status, lanes, completion/claim routing, the worker executor, and a detail-page section. **No DB migration. Artifacts stay local (referenced by path), no blob storage.**

**Tech Stack:** Next.js 15 App Router, Prisma/Postgres (Neon prod; local Postgres :5432 for tests), Zod (`strictObject`, discriminated unions), Vitest (+ jsdom), tsx worker, Codex CLI (`codex-cli 0.141.0`, spike-verified).

**Spec:** `docs/superpowers/specs/2026-06-27-analysis-stage-design.md`

**Branch:** `feat/research-analysis-stage` (already created off `origin/main`).

---

## Conventions used throughout

**Running tests.** Pure tests need no env. Postgres-backed tests (`research-worker-routes`, `research-lifecycle`) need `TEST_DATABASE_URL` on port **5432** (the `.env` value uses dead port 54329). Export it once per shell:

```bash
export TEST_DATABASE_URL="$(grep -E '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/\"//g; s/:54329/:5432/')"
```

Run a single file: `npx vitest run tests/<file>`. Type-check: `npx tsc --noEmit`. Lint a file: `npx eslint <file>`.

**Ordering matters.** Tasks 1–5 add code that stays *dormant* (no `analysis` jobs exist yet because `EXECUTABLE_STAGES` is unchanged). **Task 6 flips `EXECUTABLE_STAGES`**, which activates advancement and is where the existing `research-stages` + `research-lifecycle` tests are updated. Do the tasks in order; the suite is green after each.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/v2/schemas.ts` | `AnalysisResultSchema`, `AnalysisJobInputSchema`, types | 1 |
| `src/worker/output-validation.ts` | register `analysis` schema for output parsing | 1 |
| `src/lib/workers/lanes.ts` | `research_analysis` job type + research lane | 2 |
| `src/app/api/workers/jobs/[jobId]/complete/route.ts` | accept + fail `research_analysis` | 3 |
| `src/app/api/workers/claim/route.ts` | `buildAnalysisJobInput` + dispatch | 4 |
| `scripts/researchfinder-worker.ts` | `runAnalysisJob` + `buildAnalysisPrompt` + dispatch | 5 |
| `src/lib/research/stages.ts` | `EXECUTABLE_STAGES += analysis`, `STAGE_REGISTRY.analysis` | 6 |
| `src/lib/v2/domain.ts` | `analysis_ready` status | 6 |
| `src/app/research/[projectId]/page.tsx` | analysis render section | 8 |
| `tests/analysis-schemas.test.ts` (new) | schema coverage | 1 |
| `tests/worker-lanes.test.ts` | lane coverage | 2 |
| `tests/researchfinder-worker.test.ts` | worker executor coverage | 5 |
| `tests/research-stages.test.ts` | registry coverage | 6 |
| `tests/research-lifecycle.test.ts` | advance + completion + grounding | 6 |
| `tests/research-worker-routes.test.ts` | claim + completion routes | 7 |

---

## Task 1: Schemas + output validation

**Files:**
- Modify: `src/lib/v2/schemas.ts` (add after `ExperimentJobInputSchema`, ~line 459; add types ~line 466)
- Modify: `src/worker/output-validation.ts:23-27`
- Test: `tests/analysis-schemas.test.ts` (create)

- [ ] **Step 1: Write the failing schema test**

Create `tests/analysis-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { AnalysisJobInputSchema, AnalysisResultSchema } from "@/lib/v2/schemas";
import { parseResearchStageOutput } from "@/worker/output-validation";

const paper = {
  id: "paper-1",
  arxivId: "2401.00001",
  title: "Source Paper",
  abstract: "Abstract.",
  url: "https://arxiv.org/abs/2401.00001",
  authors: ["A. Author"],
  categories: ["cs.LG"],
  publishedAt: "2024-01-01T00:00:00.000Z"
};

const idea = {
  id: "idea-1",
  title: "Idea",
  summary: "Summary",
  expandedExplanation: "Explanation",
  trajectory: "Trajectory",
  smallestSprint: "Sprint"
};

const validResult = {
  researchProjectId: "proj-1",
  relationToSourcePaper: "Analyzes the source paper's method results.",
  successCriteriaAssessment: [
    { criterion: "Beat baseline by >2%.", status: "met", evidence: "Accuracy +4% (p<0.05)." }
  ],
  statisticalFindings: [
    { description: "Accuracy delta", method: "paired t-test", value: "p=0.03", interpretation: "Significant." }
  ],
  keyFindings: ["The method significantly beats the baseline on the small split."],
  artifacts: [{ path: "analysis/accuracy.png", caption: "Accuracy vs baseline", kind: "figure", bytes: 20480 }],
  comparisonToBaselines: "Outperforms the vanilla baseline across all seeds.",
  threatsToValidity: ["Single dataset."],
  recommendedNextSteps: ["Repeat on a larger corpus."],
  verdict: "supports_hypotheses",
  summary: "The evidence supports the hypotheses.",
  citations: [
    {
      sourceType: "paper",
      url: "https://arxiv.org/abs/2401.00001",
      sourceId: "2401.00001",
      title: "Source Paper",
      claim: "We analyze results extending this method.",
      confidence: 0.9
    }
  ]
};

describe("AnalysisResultSchema", () => {
  it("accepts a complete, grounded result", () => {
    expect(AnalysisResultSchema.parse(validResult)).toMatchObject({ verdict: "supports_hypotheses" });
  });

  it("rejects an unknown verdict", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, verdict: "great" })).toThrow();
  });

  it("rejects an empty successCriteriaAssessment array", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, successCriteriaAssessment: [] })).toThrow();
  });

  it("rejects an empty keyFindings array", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, keyFindings: [] })).toThrow();
  });

  it("rejects a result with no citations", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, citations: [] })).toThrow();
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(() => AnalysisResultSchema.parse({ ...validResult, extra: 1 })).toThrow();
  });

  it("is reachable via parseResearchStageOutput", () => {
    expect(parseResearchStageOutput("analysis", JSON.stringify(validResult))).toMatchObject({
      verdict: "supports_hypotheses"
    });
  });
});

describe("AnalysisJobInputSchema", () => {
  const validInput = {
    jobId: "job-1",
    userId: "user-1",
    researchProjectId: "proj-1",
    idea,
    paper,
    plan: {
      relationToSourcePaper: "Extends it.",
      hypotheses: ["H1"],
      successCriteria: ["Beat baseline by >2%."],
      metrics: ["accuracy"],
      baselines: ["vanilla"],
      experimentalDesign: "A/B on a small split."
    },
    literature: {
      positioning: "Novel vs. prior work.",
      gaps: ["No small-scale ablation exists."]
    },
    experiment: {
      hypothesisOutcomes: [{ hypothesis: "H1", outcome: "supported", evidence: "Accuracy rose 4%." }],
      metrics: [{ name: "accuracy", value: "0.84", baseline: "0.80" }],
      findings: ["Beats baseline."],
      limitations: ["One seed."],
      verdict: "success",
      environment: "python 3.11",
      reproductionSteps: ["uv run python train.py"],
      artifacts: [{ path: "experiment/train.py", description: "training script", bytes: 1200 }],
      logsExcerpt: "epoch 1 ... done",
      summary: "Hypothesis supported."
    },
    viability: null,
    citations: []
  };

  it("accepts a valid input with plan, literature and experiment", () => {
    expect(AnalysisJobInputSchema.parse(validInput)).toMatchObject({ jobId: "job-1" });
  });

  it("rejects an empty experiment.hypothesisOutcomes array", () => {
    expect(() =>
      AnalysisJobInputSchema.parse({
        ...validInput,
        experiment: { ...validInput.experiment, hypothesisOutcomes: [] }
      })
    ).toThrow();
  });

  it("requires the experiment block", () => {
    const { experiment: _experiment, ...withoutExperiment } = validInput;
    expect(() => AnalysisJobInputSchema.parse(withoutExperiment)).toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/analysis-schemas.test.ts`
Expected: FAIL — `AnalysisResultSchema`/`AnalysisJobInputSchema` are not exported.

- [ ] **Step 3: Add the schemas to `src/lib/v2/schemas.ts`**

Insert immediately after `ExperimentJobInputSchema` (after its closing `});`, ~line 459):

```ts
export const AnalysisResultSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: NonEmptyTrimmedStringSchema,
  successCriteriaAssessment: z
    .array(
      strictObject({
        criterion: NonEmptyTrimmedStringSchema,
        status: z.enum(["met", "partially_met", "not_met", "inconclusive"]),
        evidence: NonEmptyTrimmedStringSchema
      })
    )
    .min(1),
  statisticalFindings: z.array(
    strictObject({
      description: NonEmptyTrimmedStringSchema,
      method: NonEmptyTrimmedStringSchema.optional(),
      value: NonEmptyTrimmedStringSchema.optional(),
      interpretation: NonEmptyTrimmedStringSchema
    })
  ),
  keyFindings: z.array(NonEmptyTrimmedStringSchema).min(1),
  artifacts: z.array(
    strictObject({
      path: NonEmptyTrimmedStringSchema,
      caption: NonEmptyTrimmedStringSchema,
      kind: z.enum(["figure", "table", "data"]),
      bytes: z.number().int().nonnegative()
    })
  ),
  comparisonToBaselines: NonEmptyTrimmedStringSchema,
  threatsToValidity: z.array(NonEmptyTrimmedStringSchema),
  recommendedNextSteps: z.array(NonEmptyTrimmedStringSchema),
  verdict: z.enum(["supports_hypotheses", "mixed", "refutes_hypotheses", "inconclusive"]),
  summary: NonEmptyTrimmedStringSchema,
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
  citations: z.array(CitationSchema)
});
```

Then add the type exports next to the existing ones (after `export type ExperimentJobInput = ...`, ~line 466):

```ts
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type AnalysisJobInput = z.infer<typeof AnalysisJobInputSchema>;
```

- [ ] **Step 4: Register the schema in `src/worker/output-validation.ts`**

Add the import and the map entry:

```ts
import {
  AnalysisResultSchema,
  ExperimentResultSchema,
  GeneratedInboxSchema,
  LiteratureReviewSchema,
  NoveltyScanResultSchema,
  ResearchPlanSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";
```

```ts
const RESEARCH_STAGE_SCHEMAS = {
  plan: ResearchPlanSchema,
  literature: LiteratureReviewSchema,
  experiment: ExperimentResultSchema,
  analysis: AnalysisResultSchema
} as const;
```

- [ ] **Step 5: Run tests + type-check**

Run: `npx vitest run tests/analysis-schemas.test.ts`
Expected: PASS (all cases).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/v2/schemas.ts src/worker/output-validation.ts tests/analysis-schemas.test.ts
git commit -m "feat: add analysis stage schemas + output validation"
```

---

## Task 2: Lane / job type

**Files:**
- Modify: `src/lib/workers/lanes.ts:6-20`
- Test: `tests/worker-lanes.test.ts:30-54`

- [ ] **Step 1: Update the failing lane tests**

In `tests/worker-lanes.test.ts`, change the "six job types" test (line ~30) to seven and add `research_analysis`:

```ts
  it("LANE_JOB_TYPES.both lists all seven job types", () => {
    expect([...LANE_JOB_TYPES.both].sort()).toEqual(
      ["inbox_generation", "novelty_scan", "research_analysis", "research_experiment", "research_literature", "research_plan", "viability_check"]
    );
  });
```

Add a mapping test in the `research_experiment lane mapping` describe (after line ~54):

```ts
  it("routes research_analysis to the research and both lanes", () => {
    expect(WORKER_JOB_TYPES).toContain("research_analysis");
    expect(laneClaimsJobType("research", "research_analysis")).toBe(true);
    expect(laneClaimsJobType("both", "research_analysis")).toBe(true);
    expect(laneClaimsJobType("inbox", "research_analysis")).toBe(false);
    expect(LANE_JOB_TYPES.research).toContain("research_analysis");
  });
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run tests/worker-lanes.test.ts`
Expected: FAIL — `research_analysis` not in the lists.

- [ ] **Step 3: Add the job type in `src/lib/workers/lanes.ts`**

```ts
export const WORKER_JOB_TYPES = [
  "inbox_generation",
  "novelty_scan",
  "viability_check",
  "research_plan",
  "research_literature",
  "research_experiment",
  "research_analysis"
] as const;
```

```ts
export const LANE_JOB_TYPES: Record<WorkerLane, readonly WorkerJobType[]> = {
  inbox: ["inbox_generation", "novelty_scan"],
  research: ["viability_check", "research_plan", "research_literature", "research_experiment", "research_analysis"],
  both: ["inbox_generation", "novelty_scan", "viability_check", "research_plan", "research_literature", "research_experiment", "research_analysis"]
};
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run tests/worker-lanes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workers/lanes.ts tests/worker-lanes.test.ts
git commit -m "feat: add research_analysis worker lane/job type"
```

---

## Task 3: Completion route accepts research_analysis

**Files:**
- Modify: `src/app/api/workers/jobs/[jobId]/complete/route.ts:142` (failure branch) and `:162-170` (resolveJobType whitelist)

This is an additive change (no analysis jobs exist until Task 6, so it stays dormant); it is exercised by the route test in Task 7.

- [ ] **Step 1: Extend the failure branch (`markWorkerJobFailed`, line ~142)**

```ts
  } else if (
    input.jobType === "research_plan" ||
    input.jobType === "research_literature" ||
    input.jobType === "research_experiment" ||
    input.jobType === "research_analysis"
  ) {
    await failResearchStageJob({ jobId: input.jobId, errorMessage: input.errorMessage });
```

- [ ] **Step 2: Extend the `resolveJobType` whitelist (line ~162)**

```ts
  const requestedType =
    input.requestedType === "inbox_generation" ||
    input.requestedType === "novelty_scan" ||
    input.requestedType === "viability_check" ||
    input.requestedType === "research_plan" ||
    input.requestedType === "research_literature" ||
    input.requestedType === "research_experiment" ||
    input.requestedType === "research_analysis"
      ? input.requestedType
      : null;
```

- [ ] **Step 3: Type-check + run the existing route suite for regressions**

Run: `npx tsc --noEmit`
Expected: clean.
Run: `npx vitest run tests/research-worker-routes.test.ts` (needs `TEST_DATABASE_URL`, see Conventions)
Expected: PASS (unchanged behavior).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/workers/jobs/[jobId]/complete/route.ts"
git commit -m "feat: accept research_analysis in completion route"
```

---

## Task 4: Claim input builder + dispatch

**Files:**
- Modify: `src/app/api/workers/claim/route.ts` (imports ~12-25, dispatch ~137-157, new builder after `buildExperimentJobInput` ~362)

Dormant until Task 6 (no analysis jobs claimable yet).

- [ ] **Step 1: Add imports**

In the `@/lib/v2/schemas` import block, add `AnalysisJobInputSchema`, `type AnalysisJobInput`, and `ExperimentResultSchema`:

```ts
import {
  type InboxGenerationJobInput,
  InboxGenerationJobInputSchema,
  type NoveltyScanJobInput,
  NoveltyScanJobInputSchema,
  ResearchPlanJobInputSchema,
  type ResearchPlanJobInput,
  LiteratureJobInputSchema,
  type LiteratureJobInput,
  ResearchPlanSchema,
  LiteratureReviewSchema,
  ExperimentJobInputSchema,
  type ExperimentJobInput,
  ExperimentResultSchema,
  AnalysisJobInputSchema,
  type AnalysisJobInput
} from "@/lib/v2/schemas";
```

- [ ] **Step 2: Extend the dispatch condition + ternary (lines ~137-157)**

```ts
  if (
    laneClaimsJobType(lane, "research_plan") ||
    laneClaimsJobType(lane, "research_literature") ||
    laneClaimsJobType(lane, "research_experiment") ||
    laneClaimsJobType(lane, "research_analysis")
  ) {
    const stageJob = await claimNextResearchStageJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (stageJob) {
      try {
        const input =
          stageJob.stageType === "analysis"
            ? await buildAnalysisJobInput(stageJob)
            : stageJob.stageType === "experiment"
              ? await buildExperimentJobInput(stageJob)
              : stageJob.stageType === "literature"
                ? await buildLiteratureJobInput(stageJob)
                : await buildResearchPlanJobInput(stageJob);
        return NextResponse.json({
          job: { type: `research_${stageJob.stageType}`, id: stageJob.id, input }
        });
      } catch (error) {
        await failResearchStageJob({ jobId: stageJob.id, errorMessage: formatErrorMessage(error) });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
  }
```

- [ ] **Step 3: Add `buildAnalysisJobInput` after `buildExperimentJobInput` (after line ~362)**

```ts
async function buildAnalysisJobInput(job: ClaimedResearchStageJob): Promise<AnalysisJobInput> {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;

  const planArtifact = job.researchProject.stageArtifacts.find((a) => a.stageType === "plan");
  if (!planArtifact) {
    throw new Error("Analysis stage requires a completed plan artifact");
  }
  const litArtifact = job.researchProject.stageArtifacts.find((a) => a.stageType === "literature");
  if (!litArtifact) {
    throw new Error("Analysis stage requires a completed literature artifact");
  }
  const expArtifact = job.researchProject.stageArtifacts.find((a) => a.stageType === "experiment");
  if (!expArtifact) {
    throw new Error("Analysis stage requires a completed experiment artifact");
  }
  const plan = ResearchPlanSchema.parse(JSON.parse(planArtifact.artifactJson));
  const literature = LiteratureReviewSchema.parse(JSON.parse(litArtifact.artifactJson));
  const experiment = ExperimentResultSchema.parse(JSON.parse(expArtifact.artifactJson));

  let viability: AnalysisJobInput["viability"] = null;
  if (job.researchProject.sourceViabilityJobId) {
    const artifact = await prisma.artifact.findFirst({
      where: { jobId: job.researchProject.sourceViabilityJobId, kind: "viability-report" },
      orderBy: { createdAt: "desc" }
    });
    if (artifact) {
      viability = buildViabilityContextFromArtifactContent(artifact.content);
    }
  }

  return AnalysisJobInputSchema.parse({
    jobId: job.id,
    userId: job.userId,
    researchProjectId: job.researchProjectId,
    idea: {
      id: idea.id, title: idea.title, summary: idea.summary,
      expandedExplanation: idea.expandedExplanation, trajectory: idea.trajectory,
      smallestSprint: idea.smallestSprint
    },
    paper: {
      id: paper.id, arxivId: paper.arxivId, title: paper.title, abstract: paper.abstract, url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    plan: {
      relationToSourcePaper: plan.relationToSourcePaper,
      hypotheses: plan.hypotheses,
      successCriteria: plan.successCriteria,
      metrics: plan.metrics,
      baselines: plan.baselines,
      experimentalDesign: plan.experimentalDesign
    },
    literature: {
      positioning: literature.positioning,
      gaps: literature.gaps
    },
    experiment: {
      hypothesisOutcomes: experiment.hypothesisOutcomes,
      metrics: experiment.metrics,
      findings: experiment.findings,
      limitations: experiment.limitations,
      verdict: experiment.verdict,
      environment: experiment.environment,
      reproductionSteps: experiment.reproductionSteps,
      artifacts: experiment.artifacts,
      logsExcerpt: experiment.logsExcerpt,
      summary: experiment.summary
    },
    viability,
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    }))
  });
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/workers/claim/route.ts"
git commit -m "feat: build analysis job input from plan+literature+experiment artifacts"
```

---

## Task 5: Worker executor

**Files:**
- Modify: `scripts/researchfinder-worker.ts` (imports ~8-19, dispatch after line ~247, new helpers near the experiment executor ~600-680)
- Test: `tests/researchfinder-worker.test.ts` (add a test after the experiment executor test, ~line 811)

- [ ] **Step 1: Write the failing worker executor test**

In `tests/researchfinder-worker.test.ts`, add after the `research_experiment` executor test (the one ending ~line 811):

```ts
  it("completes claimed research_analysis jobs with an agentic run and validated output", async () => {
    const codexOutput = {
      researchProjectId: "proj-1",
      relationToSourcePaper: "Analyzes the source paper's method results.",
      successCriteriaAssessment: [
        { criterion: "Beat baseline by >2%.", status: "met", evidence: "Accuracy +4% (p<0.05)." }
      ],
      statisticalFindings: [
        { description: "Accuracy delta", method: "paired t-test", value: "p=0.03", interpretation: "Significant." }
      ],
      keyFindings: ["The method significantly beats the baseline."],
      artifacts: [{ path: "analysis/accuracy.png", caption: "Accuracy vs baseline", kind: "figure", bytes: 20480 }],
      comparisonToBaselines: "Outperforms the vanilla baseline.",
      threatsToValidity: ["Single dataset."],
      recommendedNextSteps: ["Repeat on a larger corpus."],
      verdict: "supports_hypotheses",
      summary: "The evidence supports the hypotheses.",
      citations: [
        {
          sourceType: "paper",
          url: "https://arxiv.org/abs/2401.00001",
          sourceId: "2401.00001",
          title: "Source Paper",
          claim: "We analyze results extending this method.",
          confidence: 0.9
        }
      ]
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_analysis",
            id: "ana-1",
            input: {
              jobId: "ana-1",
              userId: "user-1",
              researchProjectId: "proj-1",
              idea: {
                id: "idea-1", title: "Idea", summary: "Summary",
                expandedExplanation: "Explanation", trajectory: "Trajectory", smallestSprint: "Sprint"
              },
              paper: {
                id: "paper-1", arxivId: "2401.00001", title: "Source Paper", abstract: "Abstract.",
                url: "https://arxiv.org/abs/2401.00001", authors: ["A. Author"], categories: ["cs.LG"],
                publishedAt: "2024-01-01T00:00:00.000Z"
              },
              plan: {
                relationToSourcePaper: "Extends it.",
                hypotheses: ["H1"],
                successCriteria: ["Beat baseline by >2%."],
                metrics: ["accuracy"],
                baselines: ["vanilla"],
                experimentalDesign: "A/B on a small split."
              },
              literature: { positioning: "Novel.", gaps: ["No small-scale ablation."] },
              experiment: {
                hypothesisOutcomes: [{ hypothesis: "H1", outcome: "supported", evidence: "Accuracy rose 4%." }],
                metrics: [{ name: "accuracy", value: "0.84", baseline: "0.80" }],
                findings: ["Beats baseline."],
                limitations: ["One seed."],
                verdict: "success",
                environment: "python 3.11",
                reproductionSteps: ["uv run python train.py"],
                artifacts: [{ path: "experiment/train.py", description: "training script", bytes: 1200 }],
                logsExcerpt: "epoch 1 ... done",
                summary: "Hypothesis supported."
              },
              viability: null,
              citations: []
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodexAgentic = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(codexOutput);
    });
    vi.stubGlobal("fetch", fetchMock);

    const processed = await runResearchFinderWorker(
      {
        appUrl: "https://research.example.com",
        workerToken: "worker-token",
        codexCommand: "codex-test"
      },
      { runCodexAgentic, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(runCodexAgentic).toHaveBeenCalledTimes(1);
    expect(promptText).toContain("INPUT.json");
    expect(promptText).toContain("analysis/");
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/ana-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody.type).toBe("research_analysis");
    expect(completionBody.output).toEqual(codexOutput);
  });
```

> Note: match the surrounding tests' exact harness calls — if the experiment test uses `runResearchFinderWorker(...)` with a different name or a `createJsonResponse` helper, copy those verbatim from the experiment test directly above. The two tests must be structurally identical except for `type`/payload.

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: FAIL — no executor for `research_analysis` (FatalWorkerError) / no dispatch.

- [ ] **Step 3: Add imports in `scripts/researchfinder-worker.ts`**

Add `AnalysisJobInputSchema` + `type AnalysisJobInput` to the `@/lib/v2/schemas` import block:

```ts
import {
  AnalysisJobInputSchema,
  ExperimentJobInputSchema,
  InboxGenerationJobInputSchema,
  LiteratureJobInputSchema,
  NoveltyScanJobInputSchema,
  ResearchPlanJobInputSchema,
  type AnalysisJobInput,
  type ExperimentJobInput,
  type InboxGenerationJobInput,
  type LiteratureJobInput,
  type NoveltyScanJobInput,
  type ResearchPlanJobInput
} from "@/lib/v2/schemas";
```

- [ ] **Step 4: Add the executor + helpers near the experiment executor (after `runExperimentJob`, ~line 680)**

```ts
function analysisWorkspaceDirs(researchProjectId: string) {
  const root =
    process.env.RESEARCHFINDER_EXPERIMENT_WORKSPACE_ROOT ??
    join(process.cwd(), ".research-workspaces");
  const projectRoot = join(root, researchProjectId);
  return { projectRoot, analysisDir: join(projectRoot, "analysis") };
}

function parseAnalysisJobInput(value: unknown) {
  try {
    return AnalysisJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(`Analysis job input failed validation: ${formatErrorMessage(error)}`);
  }
}

function buildAnalysisPrompt(input: AnalysisJobInput) {
  return [
    "You are analyzing the results of a completed research experiment in your current working directory.",
    "The experiment's raw outputs (code, data, logs, artifacts) are in the experiment/ subdirectory.",
    "The full task input (idea, source paper, plan success criteria, literature positioning, and the",
    "experiment's reported results) is in analysis/INPUT.json — read it first.",
    "Do REAL analysis on the experiment's raw outputs: compute the relevant statistics and significance,",
    "judge the results against the plan's successCriteria, and generate paper-ready figures and tables.",
    "Write every figure/table/data file you produce into the analysis/ subdirectory.",
    "When finished, output ONLY valid JSON matching the AnalysisResult schema as your final message. Do not wrap it in Markdown.",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    "Required keys: researchProjectId, relationToSourcePaper,",
    "successCriteriaAssessment (>=1, each {criterion, status: met|partially_met|not_met|inconclusive, evidence}),",
    "statisticalFindings (each {description, method?, value?, interpretation}), keyFindings (>=1),",
    "artifacts (each {path, caption, kind: figure|table|data, bytes}) referencing the files you wrote under analysis/,",
    "comparisonToBaselines, threatsToValidity, recommendedNextSteps,",
    "verdict (supports_hypotheses|mixed|refutes_hypotheses|inconclusive), summary, citations (>=1).",
    "Ground in the source paper: relationToSourcePaper must explain how this analysis relates to it,",
    'and citations MUST include the source paper as sourceType "paper" with its exact url and sourceId.'
  ].join("\n");
}

async function runAnalysisJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseAnalysisJobInput(job.input);
  const { projectRoot, analysisDir } = analysisWorkspaceDirs(input.researchProjectId);
  await mkdir(analysisDir, { recursive: true });
  await writeFile(join(analysisDir, "INPUT.json"), JSON.stringify(input, null, 2), "utf8");

  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-analysis-"));
  const promptFile = join(promptDir, `${job.id}.prompt.md`);
  await writeFile(promptFile, buildAnalysisPrompt(input), "utf8");

  const controller = new AbortController();
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const heartbeat = setInterval(() => {
    void sendWorkerHeartbeat(config, job.id)
      .then((result) => {
        if (result?.aborted) controller.abort();
      })
      .catch((error) => {
        console.warn(`Heartbeat failed (continuing): ${formatErrorMessage(error)}`);
      });
  }, heartbeatMs);

  try {
    let rawOutput: string;
    try {
      rawOutput = await (options.runCodexAgentic ?? defaultRunCodexAgentic)(promptFile, {
        workspaceDir: projectRoot,
        codexCommand: config.codexCommand,
        signal: controller.signal
      });
    } catch (error) {
      const message = controller.signal.aborted
        ? "Analysis aborted by user"
        : formatErrorMessage(error);
      await failWorkerJob(config, job, new Error(message));
      throw new ProcessedWorkerError(error);
    }

    try {
      return { output: parseResearchStageOutput("analysis", rawOutput) };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    clearInterval(heartbeat);
    await rm(promptDir, { force: true, recursive: true });
  }
}
```

- [ ] **Step 5: Add the dispatch block (after the `research_experiment` block, ~line 247)**

```ts
  if (payload.job.type === "research_analysis") {
    const result = await runAnalysisJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }
```

- [ ] **Step 6: Run tests + type-check**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: PASS (new test green; experiment test still green).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/researchfinder-worker.ts tests/researchfinder-worker.test.ts
git commit -m "feat: worker analysis executor (agentic run, project-root workspace, heartbeat)"
```

---

## Task 6: Activate the stage (registry + status + lifecycle)

This flips `EXECUTABLE_STAGES`, which makes experiment advance to analysis and analysis terminal. It updates the registry test and the lifecycle test that change behavior.

**Files:**
- Modify: `src/lib/research/stages.ts:9,17-21`
- Modify: `src/lib/v2/domain.ts:63-70`
- Modify: `tests/research-stages.test.ts:16-34`
- Modify: `tests/research-lifecycle.test.ts` (helpers ~119-137; the experiment-completion test ~287-310; add two tests)

- [ ] **Step 1: Update the registry test**

In `tests/research-stages.test.ts`:

```ts
  it("lists the executable stages in order", () => {
    expect(EXECUTABLE_STAGES).toEqual(["plan", "literature", "experiment", "analysis"]);
  });
```

```ts
    expect(EXECUTABLE_STAGES).toContain("analysis");
    expect(nextExecutableStage("experiment")).toBe("analysis");
    expect(nextExecutableStage("analysis")).toBeNull();
    expect(STAGE_REGISTRY.analysis.requiresSourcePaperCitation).toBe(true);
```

And in the `STAGE_REGISTRY` outputSchema assertions block (lines ~31-34), add:

```ts
    expect(STAGE_REGISTRY.analysis.outputSchema).toBe(AnalysisResultSchema);
```

Add the import at the top of the file:

```ts
import { AnalysisResultSchema } from "@/lib/v2/schemas";
```

(If the test imports `ExperimentResultSchema` already, add `AnalysisResultSchema` to that same import.)

- [ ] **Step 2: Update the lifecycle experiment-completion test (lines ~287-310)**

Replace the `"experiment completion sets the project experiment_ready and persists the artifact"` test with an advance test (mirrors the literature→experiment test):

```ts
  it("experiment completion enqueues an analysis job and sets the project running", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      const exp = await advanceToExperimentClaim(db, {
        user, idea, paper: { arxivId: paper.arxivId, url: paper.url }
      });
      expect(exp?.stageType).toBe("experiment");
      await completeResearchStageJob({
        jobId: exp!.id, workerId: "w",
        output: experimentOutput(exp!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: exp!.researchProjectId } });
      expect(project).toMatchObject({ currentStage: "analysis", status: "running" });
      const analysisJob = await db.researchStageJob.findFirst({
        where: { researchProjectId: project.id, stageType: "analysis" }
      });
      expect(analysisJob?.status).toBe("queued");
      const experimentArtifact = await db.researchStageArtifact.findFirst({
        where: { researchProjectId: project.id, stageType: "experiment" }
      });
      expect(experimentArtifact).not.toBeNull();
    });
  });
```

- [ ] **Step 3: Add the analysis helpers (after `advanceToExperimentClaim`, ~line 137)**

```ts
function analysisOutput(researchProjectId: string, paper: { arxivId: string; url: string }) {
  return {
    researchProjectId,
    relationToSourcePaper: "Analyzes results extending the source paper's method.",
    successCriteriaAssessment: [
      { criterion: "Beats baseline.", status: "met" as const, evidence: "Accuracy +4% (p<0.05)." }
    ],
    statisticalFindings: [
      { description: "Accuracy delta", method: "paired t-test", value: "p=0.03", interpretation: "Significant." }
    ],
    keyFindings: ["The method significantly beats the baseline."],
    artifacts: [{ path: "analysis/accuracy.png", caption: "Accuracy vs baseline", kind: "figure" as const, bytes: 20480 }],
    comparisonToBaselines: "Outperforms the vanilla baseline.",
    threatsToValidity: ["Single dataset."],
    recommendedNextSteps: ["Repeat on a larger corpus."],
    verdict: "supports_hypotheses" as const,
    summary: "The evidence supports the hypotheses.",
    citations: [
      { sourceType: "paper" as const, url: paper.url, sourceId: paper.arxivId, title: "Source paper", claim: "Original method.", confidence: 0.9 }
    ]
  };
}

async function advanceToAnalysisClaim(
  db: PrismaClient,
  ids: { user: { id: string }; idea: { id: string }; paper: { arxivId: string; url: string } }
) {
  const exp = await advanceToExperimentClaim(db, ids);
  await completeResearchStageJob({
    jobId: exp!.id, workerId: "w",
    output: experimentOutput(exp!.researchProjectId, ids.paper)
  });
  return claimNextResearchStageJob({ userId: ids.user.id, workerId: "w" });
}
```

- [ ] **Step 4: Add the analysis completion + grounding tests (in the `completeResearchStageJob advance` describe, after the experiment test)**

```ts
  it("analysis completion sets the project analysis_ready and persists the artifact", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      const ana = await advanceToAnalysisClaim(db, {
        user, idea, paper: { arxivId: paper.arxivId, url: paper.url }
      });
      expect(ana?.stageType).toBe("analysis");
      await completeResearchStageJob({
        jobId: ana!.id, workerId: "w",
        output: analysisOutput(ana!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: ana!.researchProjectId } });
      expect(project.status).toBe("analysis_ready");
      const analysisArtifact = await db.researchStageArtifact.findFirst({
        where: { researchProjectId: project.id, stageType: "analysis" }
      });
      expect(analysisArtifact).not.toBeNull();
    });
  });

  it("rejects an analysis output that omits the source-paper citation", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      const ana = await advanceToAnalysisClaim(db, {
        user, idea, paper: { arxivId: paper.arxivId, url: paper.url }
      });
      const bad = analysisOutput(ana!.researchProjectId, { arxivId: paper.arxivId, url: paper.url });
      bad.citations = bad.citations.map((c) => ({ ...c, sourceType: "generated_analysis" as const, url: "" })) as unknown as typeof bad.citations;
      await expect(
        completeResearchStageJob({ jobId: ana!.id, workerId: "w", output: bad })
      ).rejects.toThrow();
      const artifact = await db.researchStageArtifact.findFirst({
        where: { researchProjectId: ana!.researchProjectId, stageType: "analysis" }
      });
      expect(artifact).toBeNull();
    });
  });
```

- [ ] **Step 5: Run to confirm the tests fail (registry not flipped yet)**

Run: `npx vitest run tests/research-stages.test.ts`
Expected: FAIL (`EXECUTABLE_STAGES` still 3, `nextExecutableStage("experiment")` null).

- [ ] **Step 6: Add `analysis_ready` to `src/lib/v2/domain.ts`**

```ts
export const RESEARCH_PROJECT_STATUSES = [
  "running",
  "plan_ready",
  "literature_ready",
  "experiment_ready",
  "analysis_ready",
  "aborted",
  "failed"
] as const;
```

- [ ] **Step 7: Flip the registry in `src/lib/research/stages.ts`**

Add the import:

```ts
import { AnalysisResultSchema, ExperimentResultSchema, LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";
```

```ts
export const EXECUTABLE_STAGES = ["plan", "literature", "experiment", "analysis"] as const;
```

```ts
export const STAGE_REGISTRY: Record<ExecutableStage, StageDefinition> = {
  plan: { outputSchema: ResearchPlanSchema, requiresSourcePaperCitation: true },
  literature: { outputSchema: LiteratureReviewSchema, requiresSourcePaperCitation: true },
  experiment: { outputSchema: ExperimentResultSchema, requiresSourcePaperCitation: true },
  analysis: { outputSchema: AnalysisResultSchema, requiresSourcePaperCitation: true }
};
```

- [ ] **Step 8: Run the affected suites + type-check**

Run: `npx vitest run tests/research-stages.test.ts`
Expected: PASS.
Run: `npx vitest run tests/research-lifecycle.test.ts` (needs `TEST_DATABASE_URL`)
Expected: PASS (advance + completion + grounding, including the two new tests).
Run: `npx tsc --noEmit`
Expected: clean (`STAGE_REGISTRY` now satisfies the `Record<ExecutableStage, …>` type with the analysis entry).

- [ ] **Step 9: Commit**

```bash
git add src/lib/research/stages.ts src/lib/v2/domain.ts tests/research-stages.test.ts tests/research-lifecycle.test.ts
git commit -m "feat: activate analysis as an executable stage (terminal analysis_ready)"
```

---

## Task 7: Claim + completion route tests

**Files:**
- Modify: `tests/research-worker-routes.test.ts` (add a `seedProjectWithAnalysisJob` helper mirroring `seedProjectWithExperimentJob`, plus a claim test and a completion test)

- [ ] **Step 1: Add the seed helper**

Copy `seedProjectWithExperimentJob` to a new `seedProjectWithAnalysisJob`. Make these changes: use a fresh paper arxivId `"2502.00005"`; set the project `currentStage: "analysis"`; keep the plan + literature artifact seeding; **add** an experiment artifact; and create an **analysis** stage job instead of an experiment one. The experiment artifact to add (place after the literature artifact `create`):

```ts
  const experimentArtifact = {
    researchProjectId: project.id,
    relationToSourcePaper: "Implements and tests the source paper's method.",
    implementationSummary: "Built a minimal training loop.",
    environment: "python 3.11",
    hypothesisOutcomes: [{ hypothesis: "Hypothesis A", outcome: "supported", evidence: "Accuracy improved." }],
    metrics: [{ name: "accuracy", value: "0.84", baseline: "0.80" }],
    findings: ["Beats the baseline on the small split."],
    limitations: ["Single seed."],
    artifacts: [{ path: "experiment/train.py", description: "training script", bytes: 1200 }],
    logsExcerpt: "epoch 1 ... done",
    reproductionSteps: ["uv run python train.py"],
    verdict: "success",
    summary: "Hypothesis supported.",
    citations: [
      { sourceType: "paper", title: "Source Paper", url: "https://arxiv.org/abs/2502.00005", sourceId: "2502.00005", claim: "Foundational", confidence: 0.9 }
    ]
  };
  await client.researchStageArtifact.create({
    data: {
      researchProjectId: project.id,
      stageType: "experiment",
      artifactJson: JSON.stringify(experimentArtifact)
    }
  });
  await client.researchStageJob.create({
    data: {
      researchProjectId: project.id,
      userId: user.id,
      stageType: "analysis",
      status: "queued",
      inputJson: JSON.stringify({ researchProjectId: project.id })
    }
  });
  return { user, worker, paper, project };
```

> Ensure the plan + literature artifacts in this helper use the same paper URL/sourceId `https://arxiv.org/abs/2502.00005` / `2502.00005` for grounding consistency, and that `seedProjectWithAnalysisJob` does NOT also create an experiment stage job (only the analysis job should be queued/claimable).

- [ ] **Step 2: Add the claim test**

```ts
describe("research_analysis worker routes", () => {
  it("claims a research_analysis job and returns input with plan, literature and experiment", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithAnalysisJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      const response = await POST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST",
          headers: { authorization: "Bearer t" }
        })
      );
      const payload = (await response.json()) as {
        job: {
          type: string;
          input: {
            researchProjectId: string;
            paper: { arxivId: string };
            plan: { successCriteria: string[] };
            experiment: { findings: string[] };
          };
        };
      };
      expect(payload.job.type).toBe("research_analysis");
      expect(payload.job.input.paper.arxivId).toBe("2502.00005");
      expect(payload.job.input.plan.successCriteria.length).toBeGreaterThan(0);
      expect(payload.job.input.experiment.findings.length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 3: Add the completion test (in the `research stage completion routes` describe)**

```ts
  it("completes a research_analysis job and sets the project analysis_ready", async () => {
    const { POST: completePOST } = await import(
      "@/app/api/workers/jobs/[jobId]/complete/route"
    );
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker, project } = await seedProjectWithAnalysisJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      // Claim it so it is "running" and owned by this worker.
      const { POST: claimPOST } = await import("@/app/api/workers/claim/route");
      const claimResponse = await claimPOST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST",
          headers: { authorization: "Bearer t" }
        })
      );
      const { job } = (await claimResponse.json()) as { job: { id: string } };
      const jobId = job.id;

      const output = {
        researchProjectId: project.id,
        relationToSourcePaper: "Analyzes results extending the source paper.",
        successCriteriaAssessment: [
          { criterion: "Beats baseline", status: "met", evidence: "Accuracy +4%." }
        ],
        statisticalFindings: [
          { description: "Accuracy delta", method: "t-test", value: "p=0.03", interpretation: "Significant." }
        ],
        keyFindings: ["Beats the baseline."],
        artifacts: [{ path: "analysis/accuracy.png", caption: "Accuracy", kind: "figure", bytes: 2048 }],
        comparisonToBaselines: "Outperforms vanilla.",
        threatsToValidity: ["Single dataset."],
        recommendedNextSteps: ["Scale up."],
        verdict: "supports_hypotheses",
        summary: "Hypotheses supported.",
        citations: [
          { sourceType: "paper", title: "Source Paper", url: "https://arxiv.org/abs/2502.00005", sourceId: "2502.00005", claim: "Foundational", confidence: 0.9 }
        ]
      };

      const completeResponse = await completePOST(
        new Request(`http://localhost/api/workers/jobs/${jobId}/complete`, {
          method: "POST",
          headers: { authorization: "Bearer t" },
          body: JSON.stringify({ type: "research_analysis", output })
        }),
        { params: Promise.resolve({ jobId }) }
      );
      expect(completeResponse.status).toBe(200);

      const updated = await client.researchProject.findUniqueOrThrow({ where: { id: project.id } });
      expect(updated.status).toBe("analysis_ready");
      const artifact = await client.researchStageArtifact.findFirst({
        where: { researchProjectId: project.id, stageType: "analysis" }
      });
      expect(artifact).not.toBeNull();
    });
  });
```

> Match the exact completion-route invocation used by the existing experiment/literature completion tests in this file (the `params` shape and the body envelope). If they pass `params` differently, copy that call signature verbatim.

- [ ] **Step 4: Run the route suite**

Run: `npx vitest run tests/research-worker-routes.test.ts` (needs `TEST_DATABASE_URL`)
Expected: PASS (new claim + completion tests, existing ones unchanged).

- [ ] **Step 5: Commit**

```bash
git add tests/research-worker-routes.test.ts
git commit -m "test: cover analysis claim + completion routes"
```

---

## Task 8: Detail page render section

**Files:**
- Modify: `src/app/research/[projectId]/page.tsx` (import ~line 8; parse ~line 49-55; fallback guard ~line 265; render after the experiment section ~line 263)

No unit test (the existing plan/literature/experiment sections have none; this server component is covered by `tsc` + manual check), matching the codebase pattern.

- [ ] **Step 1: Add the import**

```ts
import { AnalysisResultSchema, ExperimentResultSchema, LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";
```

- [ ] **Step 2: Parse the analysis artifact (after the `experiment` parse block, ~line 55)**

```ts
  const analysisArtifact = artifactByStage.get("analysis");
  const analysis = analysisArtifact
    ? (() => {
        const r = AnalysisResultSchema.safeParse(JSON.parse(analysisArtifact.artifactJson));
        return r.success ? r.data : null;
      })()
    : null;
```

- [ ] **Step 3: Render the section (immediately after the experiment `</section> ) : null}` block, ~line 263)**

```tsx
        {analysis ? (
          <section className="mt-4 grid gap-4 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            <div>
              <h2 className="text-lg font-semibold text-rf-white">Analysis</h2>
              <p className="mt-1">
                <StatusBadge status={analysis.verdict} /> {analysis.summary}
              </p>
              <p className="mt-1">{analysis.relationToSourcePaper}</p>
            </div>
            <div>
              <h3 className="font-semibold text-rf-white">Success criteria</h3>
              <ul className="mt-1 grid gap-2">
                {analysis.successCriteriaAssessment.map((item, index) => (
                  <li key={`${item.criterion}-${index}`}>
                    <span className="text-rf-white">{item.criterion}</span> —{" "}
                    <span className="uppercase">{item.status.replaceAll("_", " ")}</span>: {item.evidence}
                  </li>
                ))}
              </ul>
            </div>
            {analysis.statisticalFindings.length > 0 ? (
              <div>
                <h3 className="font-semibold text-rf-white">Statistical findings</h3>
                <ul className="mt-1 grid gap-1">
                  {analysis.statisticalFindings.map((finding, index) => (
                    <li key={`${finding.description}-${index}`}>
                      <span className="text-rf-white">{finding.description}</span>
                      {finding.method ? ` [${finding.method}]` : ""}
                      {finding.value ? ` = ${finding.value}` : ""}: {finding.interpretation}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <PlanList title="Key findings" items={analysis.keyFindings} />
            <div>
              <h3 className="font-semibold text-rf-white">Comparison to baselines</h3>
              <p className="mt-1">{analysis.comparisonToBaselines}</p>
            </div>
            <PlanList title="Threats to validity" items={analysis.threatsToValidity} />
            <PlanList title="Recommended next steps" items={analysis.recommendedNextSteps} />
            {analysis.artifacts.length > 0 ? (
              <div>
                <h3 className="font-semibold text-rf-white">Artifacts</h3>
                <ul className="mt-1 grid gap-1">
                  {analysis.artifacts.map((artifact, index) => (
                    <li key={`${artifact.path}-${index}`}>
                      <span className="text-rf-white">{artifact.path}</span> — {artifact.caption}{" "}
                      <span className="text-rf-muted">({artifact.kind}, {artifact.bytes} bytes)</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <h3 className="font-semibold text-rf-white">Citations</h3>
              <ul className="mt-1 grid gap-1">
                {analysis.citations.map((citation, index) => (
                  <li key={`${citation.title}-${index}`}>
                    {citation.url ? (
                      <a className="text-rf-violetSoft" href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>
                    ) : (
                      <span className="text-rf-white">{citation.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
```

- [ ] **Step 4: Widen the no-artifact fallback guard (~line 265)**

```tsx
        {!plan && !literature && !experiment && !analysis ? (
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/research/[projectId]/page.tsx"
git commit -m "feat: render analysis results on the research detail page"
```

---

## Task 9: Final verification

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Lint every changed file**

Run:
```bash
npx eslint src/lib/v2/schemas.ts src/worker/output-validation.ts src/lib/workers/lanes.ts "src/app/api/workers/jobs/[jobId]/complete/route.ts" "src/app/api/workers/claim/route.ts" scripts/researchfinder-worker.ts src/lib/research/stages.ts src/lib/v2/domain.ts "src/app/research/[projectId]/page.tsx" tests/analysis-schemas.test.ts tests/worker-lanes.test.ts tests/researchfinder-worker.test.ts tests/research-stages.test.ts tests/research-lifecycle.test.ts tests/research-worker-routes.test.ts; echo "exit=$?"
```
Expected: `exit=0`. (The repo-wide `eslint .` has ~730 pre-existing errors — ignore those; only changed files must be clean.)

- [ ] **Step 3: Run the full analysis-affected test subset**

```bash
export TEST_DATABASE_URL="$(grep -E '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/\"//g; s/:54329/:5432/')"
npx vitest run tests/analysis-schemas.test.ts tests/worker-lanes.test.ts tests/researchfinder-worker.test.ts tests/research-stages.test.ts tests/research-lifecycle.test.ts tests/research-worker-routes.test.ts
```
Expected: all green.

> Do NOT run the full 26-file Postgres suite — it hangs (>3h, DB-contention infra issue, not a code defect). The subset above is the branch-relevant coverage.

- [ ] **Step 4: Final commit (if any uncommitted cleanup)**

```bash
git status
# commit anything outstanding
```

---

## Self-review (completed by plan author)

- **Spec coverage:** schemas (T1) ✓, registry/status/output-validation (T1+T6) ✓, lanes (T2) ✓, completion (T3) ✓, claim builder (T4) ✓, worker executor with project-root workspace + heartbeat + abort (T5) ✓, detail render (T8) ✓, tests mirroring experiment coverage (T1,T5,T6,T7) ✓, no DB migration ✓, local artifacts (no upload) ✓.
- **Type consistency:** `AnalysisResultSchema`/`AnalysisJobInputSchema`/`AnalysisResult`/`AnalysisJobInput`, `analysisWorkspaceDirs`, `runAnalysisJob`, `buildAnalysisJobInput`, `analysisOutput`, `advanceToAnalysisClaim`, `seedProjectWithAnalysisJob` used consistently across tasks.
- **Ordering:** wiring (T1–T5) lands dormant; T6 flips `EXECUTABLE_STAGES` + updates the two tests that change behavior; suite green after each task.
- **No placeholders:** every code step shows full code; commands have expected output.
