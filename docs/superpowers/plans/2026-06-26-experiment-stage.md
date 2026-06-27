# Experiment Stage (Local Agentic Execution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `experiment` as the third executable research stage, where a worker runs Codex in full agentic mode inside a per-experiment local workspace to actually implement and run the experiment, producing a source-paper-grounded `ExperimentResult`.

**Architecture:** Reuses the generic stage registry (`ResearchStageJob`/`ResearchStageArtifact`, `STAGE_REGISTRY`, `nextExecutableStage`). New infrastructure: an agentic Codex runner (`runCodexAgentic`), a per-experiment workspace, and a heartbeat-based long-running-job model (so a multi-hour experiment is never mistaken for a dead worker, and the user's abort tree-kills it). No fixed runtime cap.

**Tech Stack:** Next.js 15 App Router (route handlers), Prisma/Postgres, Zod (`strictObject`, discriminated unions), Vitest + Testing Library, the Codex CLI (`codex exec`), Tailwind `rf-*` tokens.

**Spec:** `docs/superpowers/specs/2026-06-26-experiment-stage-design.md`

**Source-paper grounding invariant:** every citation-emitting stage must include the source paper as a `sourceType: "paper"` citation matching `sourceId`/`url`, enforced by the existing generic `assertCitesSourcePaper` in `src/lib/jobs/research.ts`. The experiment stage sets `requiresSourcePaperCitation: true`, so no new grounding code is needed.

**Testing notes (read before starting):**
- Postgres-backed tests run on local port 5432. Run a single file with:
  `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run <file> --no-file-parallelism --testTimeout 60000`
- The full 26-file Postgres suite hangs (known infra issue) — verify the branch-relevant subset, not the whole suite.
- Component/jsdom tests (e.g. `tests/research-pages.test.tsx`) do **not** need the DB override.
- Updating `prisma/schema.prisma` is enough for tests (`db push` reads the schema); migration SQL files are only for prod deploy.

---

## File Structure

**New files:**
- `src/app/api/workers/jobs/[jobId]/heartbeat/route.ts` — worker heartbeat endpoint (updates `heartbeatAt`, reports abort).
- `prisma/migrations/20260626220000_research_stage_heartbeat/migration.sql` — adds `heartbeatAt` column.
- `tests/experiment-schemas.test.ts` — `ExperimentResultSchema` / `ExperimentJobInputSchema` unit tests.
- `tests/research-stage-heartbeat.test.ts` — heartbeat endpoint + helper (Postgres).
- `tests/codex-runner-agentic.test.ts` — agentic arg-builder + abort-kill unit tests.

**Modified files:**
- `src/lib/v2/schemas.ts` — add `ExperimentResultSchema`, `ExperimentJobInputSchema`, type aliases.
- `src/lib/research/stages.ts` — `ExecutableStage` type, add `experiment` to `EXECUTABLE_STAGES` + `STAGE_REGISTRY`.
- `src/worker/output-validation.ts` — add `experiment` to `RESEARCH_STAGE_SCHEMAS`.
- `src/lib/jobs/research.ts` — registry cast → `ExecutableStage`; heartbeat-aware stale claim; `recordResearchStageHeartbeat`.
- `src/lib/v2/domain.ts` — add `literature_ready` (if missing) + `experiment_ready` to `RESEARCH_PROJECT_STATUSES`.
- `prisma/schema.prisma` — add `heartbeatAt DateTime?` to `ResearchStageJob`.
- `src/lib/workers/lanes.ts` — add `research_experiment` to `WORKER_JOB_TYPES` + research/both lanes.
- `src/app/api/workers/jobs/[jobId]/complete/route.ts` — widen `WorkerJobType` union, `requestedType` whitelist, `markWorkerJobFailed` routing.
- `src/app/api/workers/claim/route.ts` — `buildExperimentJobInput`, lane check + dispatch.
- `src/worker/codex-runner.ts` — `buildCodexAgenticExecArgs`, `runCodexAgentic`, tree-kill helper.
- `scripts/researchfinder-worker.ts` — `research_experiment` dispatch, `runExperimentJob`, heartbeat HTTP helper, `.gitignore` workspace root.
- `src/app/research/[projectId]/page.tsx` — experiment section.
- `.gitignore` — ignore `.research-workspaces/`.
- Existing tests touched: `tests/research-lifecycle.test.ts` (literature now advances to experiment), `tests/research-stages.test.ts`, `tests/research-worker-routes.test.ts`, `tests/worker-lanes.test.ts` / `tests/worker-lane-claim.test.ts`.

---

## Task 1: Experiment schemas

**Files:**
- Modify: `src/lib/v2/schemas.ts` (add after `LiteratureReviewSchema`/`LiteratureJobInputSchema`, before the type-alias block at lines 376-388)
- Test: `tests/experiment-schemas.test.ts` (create)

The new schemas reuse the module-private helpers `strictObject`, `NonEmptyTrimmedStringSchema`, `UnitScoreSchema`, and the exported `CitationSchema` — all already in this file. The `idea`/`paper` blocks are copied verbatim from `LiteratureJobInputSchema` (lines 345-374). Result-array `.min(1)` rules mirror `ResearchPlanSchema`/`LiteratureReviewSchema`.

- [ ] **Step 1: Write the failing test**

Create `tests/experiment-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  ExperimentJobInputSchema,
  ExperimentResultSchema
} from "@/lib/v2/schemas";

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
  relationToSourcePaper: "Extends the source paper's method.",
  implementationSummary: "Built a small training loop.",
  environment: "python 3.11, torch 2.2",
  hypothesisOutcomes: [
    { hypothesis: "H1", outcome: "supported", evidence: "Accuracy rose 4%." }
  ],
  metrics: [{ name: "accuracy", value: "0.84", baseline: "0.80" }],
  findings: ["The method beats the baseline on the small split."],
  limitations: ["Only one seed."],
  artifacts: [{ path: "train.py", description: "training script", bytes: 1200 }],
  logsExcerpt: "epoch 1 ... done",
  reproductionSteps: ["uv run python train.py"],
  verdict: "success",
  summary: "Hypothesis supported on the minimal experiment.",
  citations: [
    {
      sourceType: "paper",
      url: "https://arxiv.org/abs/2401.00001",
      sourceId: "2401.00001",
      title: "Source Paper",
      claim: "We extend this method.",
      confidence: 0.9
    }
  ]
};

describe("ExperimentResultSchema", () => {
  it("accepts a complete, grounded result", () => {
    expect(ExperimentResultSchema.parse(validResult)).toMatchObject({ verdict: "success" });
  });

  it("rejects an unknown verdict", () => {
    expect(() => ExperimentResultSchema.parse({ ...validResult, verdict: "great" })).toThrow();
  });

  it("rejects an empty hypothesisOutcomes array", () => {
    expect(() => ExperimentResultSchema.parse({ ...validResult, hypothesisOutcomes: [] })).toThrow();
  });

  it("rejects a result with no citations", () => {
    expect(() => ExperimentResultSchema.parse({ ...validResult, citations: [] })).toThrow();
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(() => ExperimentResultSchema.parse({ ...validResult, extra: 1 })).toThrow();
  });
});

describe("ExperimentJobInputSchema", () => {
  const validInput = {
    jobId: "job-1",
    userId: "user-1",
    researchProjectId: "proj-1",
    idea,
    paper,
    plan: {
      relationToSourcePaper: "Extends it.",
      hypotheses: ["H1"],
      experimentalDesign: "A/B on a small split.",
      protocolSteps: ["Prepare data", "Train", "Evaluate"],
      datasets: ["toy-set"],
      baselines: ["vanilla"],
      metrics: ["accuracy"],
      successCriteria: ["Beat baseline by >2%."]
    },
    literature: {
      positioning: "Novel vs. prior work.",
      gaps: ["No small-scale ablation exists."]
    },
    viability: null,
    citations: []
  };

  it("accepts a valid input with plan + literature", () => {
    expect(ExperimentJobInputSchema.parse(validInput)).toMatchObject({ jobId: "job-1" });
  });

  it("rejects an empty plan.hypotheses array", () => {
    expect(() =>
      ExperimentJobInputSchema.parse({ ...validInput, plan: { ...validInput.plan, hypotheses: [] } })
    ).toThrow();
  });

  it("requires the literature block", () => {
    const { literature: _literature, ...withoutLiterature } = validInput;
    expect(() => ExperimentJobInputSchema.parse(withoutLiterature)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/experiment-schemas.test.ts`
Expected: FAIL — `ExperimentResultSchema`/`ExperimentJobInputSchema` are not exported.

- [ ] **Step 3: Add the schemas**

In `src/lib/v2/schemas.ts`, immediately after `LiteratureJobInputSchema` (ends at line 374) and before the type-alias block (line 376), insert:

```ts
export const ExperimentResultSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: NonEmptyTrimmedStringSchema,
  implementationSummary: NonEmptyTrimmedStringSchema,
  environment: NonEmptyTrimmedStringSchema,
  hypothesisOutcomes: z
    .array(
      strictObject({
        hypothesis: NonEmptyTrimmedStringSchema,
        outcome: z.enum(["supported", "refuted", "inconclusive"]),
        evidence: NonEmptyTrimmedStringSchema
      })
    )
    .min(1),
  metrics: z
    .array(
      strictObject({
        name: NonEmptyTrimmedStringSchema,
        value: NonEmptyTrimmedStringSchema,
        unit: NonEmptyTrimmedStringSchema.optional(),
        baseline: NonEmptyTrimmedStringSchema.optional()
      })
    ),
  findings: z.array(NonEmptyTrimmedStringSchema).min(1),
  limitations: z.array(NonEmptyTrimmedStringSchema),
  artifacts: z.array(
    strictObject({
      path: NonEmptyTrimmedStringSchema,
      description: NonEmptyTrimmedStringSchema.optional(),
      bytes: z.number().int().nonnegative()
    })
  ),
  logsExcerpt: NonEmptyTrimmedStringSchema,
  reproductionSteps: z.array(NonEmptyTrimmedStringSchema).min(1),
  verdict: z.enum(["success", "partial", "failed"]),
  summary: NonEmptyTrimmedStringSchema,
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
  citations: z.array(CitationSchema)
});
```

Then, in the type-alias block (after line 379's `export type LiteratureJobInput = ...`), add:

```ts
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;
export type ExperimentJobInput = z.infer<typeof ExperimentJobInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/experiment-schemas.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/schemas.ts tests/experiment-schemas.test.ts
git commit -m "feat: add experiment stage schemas"
```

---

## Task 2: Stage registry + validation + status (activate experiment)

**Files:**
- Modify: `src/lib/research/stages.ts:1-30`
- Modify: `src/worker/output-validation.ts:22-25`
- Modify: `src/lib/jobs/research.ts:134` (the `STAGE_REGISTRY[stage as "plan" | "literature"]` cast)
- Modify: `src/lib/v2/domain.ts` (RESEARCH_PROJECT_STATUSES)
- Test: `tests/research-stages.test.ts` (extend), and update `tests/research-lifecycle.test.ts` (literature now advances to experiment)

This task makes `experiment` a real executable stage and removes the triplicated executable-stage literal union (the reviewer's flagged footgun) via a shared `ExecutableStage` type.

- [ ] **Step 1: Write/adjust the failing tests**

In `tests/research-stages.test.ts`, add (the file already imports from `@/lib/research/stages`):

```ts
import { EXECUTABLE_STAGES, STAGE_REGISTRY, nextExecutableStage } from "@/lib/research/stages";

it("includes experiment as an executable stage after literature", () => {
  expect(EXECUTABLE_STAGES).toContain("experiment");
  expect(nextExecutableStage("literature")).toBe("experiment");
  expect(nextExecutableStage("experiment")).toBeNull();
  expect(STAGE_REGISTRY.experiment.requiresSourcePaperCitation).toBe(true);
});
```

In `tests/research-lifecycle.test.ts`, find the test asserting literature completion sets `literature_ready` and change its expectation: after literature completes, the project advances to `experiment` (status `running`, `currentStage` `experiment`) and a queued `experiment` stage job exists. (Search for `literature_ready` in that file; replace the terminal assertion with an advancement assertion mirroring the existing plan→literature test in the same file.)

```ts
// literature completion now enqueues experiment (no longer terminal)
const project = await tx.researchProject.findUniqueOrThrow({ where: { id: projectId } });
expect(project.status).toBe("running");
expect(project.currentStage).toBe("experiment");
const expJob = await tx.researchStageJob.findFirst({
  where: { researchProjectId: projectId, stageType: "experiment" }
});
expect(expJob?.status).toBe("queued");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/research-stages.test.ts`
Expected: FAIL — `experiment` not in `EXECUTABLE_STAGES`, `STAGE_REGISTRY.experiment` undefined.

- [ ] **Step 3: Update `stages.ts`**

Replace lines 4-19 of `src/lib/research/stages.ts` with:

```ts
export const RESEARCH_STAGES = ["plan", "literature", "experiment", "analysis", "paper"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

// Stages with a worker executor today. Analysis/paper are added here (plus a
// STAGE_REGISTRY entry) as they are built; the harness then advances into them automatically.
export const EXECUTABLE_STAGES = ["plan", "literature", "experiment"] as const;
export type ExecutableStage = (typeof EXECUTABLE_STAGES)[number];

type StageDefinition = {
  outputSchema: ZodTypeAny;
  requiresSourcePaperCitation: boolean;
};

export const STAGE_REGISTRY: Record<ExecutableStage, StageDefinition> = {
  plan: { outputSchema: ResearchPlanSchema, requiresSourcePaperCitation: true },
  literature: { outputSchema: LiteratureReviewSchema, requiresSourcePaperCitation: true },
  experiment: { outputSchema: ExperimentResultSchema, requiresSourcePaperCitation: true }
};
```

Update the import on line 1 to add `ExperimentResultSchema`:

```ts
import { ExperimentResultSchema, LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";
```

> Note: `EXECUTABLE_STAGES` changes from `ResearchStage[]` to a readonly tuple. `nextExecutableStage` uses `EXECUTABLE_STAGES.includes(stage)` (line 26) — with a readonly tuple, change that call to `(EXECUTABLE_STAGES as readonly ResearchStage[]).includes(stage)` and `claimNextResearchStageJob`'s `stageType: { in: EXECUTABLE_STAGES }` to `stageType: { in: [...EXECUTABLE_STAGES] }` (Prisma wants a mutable array).

- [ ] **Step 4: Update `output-validation.ts`**

Replace `RESEARCH_STAGE_SCHEMAS` (lines 22-25) in `src/worker/output-validation.ts`:

```ts
const RESEARCH_STAGE_SCHEMAS = {
  plan: ResearchPlanSchema,
  literature: LiteratureReviewSchema,
  experiment: ExperimentResultSchema
} as const;
```

Add `ExperimentResultSchema` to the import from `@/lib/v2/schemas` (lines 3-8).

- [ ] **Step 5: Update `research.ts` registry cast**

In `src/lib/jobs/research.ts`, change line 134 from:

```ts
    const definition = STAGE_REGISTRY[stage as "plan" | "literature"];
```

to:

```ts
    const definition = STAGE_REGISTRY[stage as ExecutableStage];
```

Add `ExecutableStage` to the import on line 4:

```ts
import { EXECUTABLE_STAGES, STAGE_REGISTRY, nextExecutableStage, type ExecutableStage, type ResearchStage } from "@/lib/research/stages";
```

Also apply the `stageType: { in: [...EXECUTABLE_STAGES] }` spread in `claimNextResearchStageJob` (line 68) noted in Step 3.

- [ ] **Step 6: Update `domain.ts` statuses**

Open `src/lib/v2/domain.ts`, find `RESEARCH_PROJECT_STATUSES`. Ensure it contains both `"literature_ready"` and `"experiment_ready"`. Example (preserve existing members and ordering, only add missing ones):

```ts
export const RESEARCH_PROJECT_STATUSES = [
  "running",
  "plan_ready",
  "literature_ready",
  "experiment_ready",
  "aborted",
  "failed"
] as const;
```

If a domain test pins the exact contents of `RESEARCH_PROJECT_STATUSES`, update that test's expected array to match.

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run tests/research-stages.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean (the worker/route callers still compile — they reference stage types via strings).

- [ ] **Step 8: Run the lifecycle test (Postgres)**

Run: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-lifecycle.test.ts --no-file-parallelism --testTimeout 60000`
Expected: PASS (literature now advances to experiment).

- [ ] **Step 9: Commit**

```bash
git add src/lib/research/stages.ts src/worker/output-validation.ts src/lib/jobs/research.ts src/lib/v2/domain.ts tests/research-stages.test.ts tests/research-lifecycle.test.ts
git commit -m "feat: register experiment as an executable stage (shared ExecutableStage type)"
```

---

## Task 3: heartbeatAt column (schema + migration)

**Files:**
- Modify: `prisma/schema.prisma` (ResearchStageJob model, lines 457-478)
- Create: `prisma/migrations/20260626220000_research_stage_heartbeat/migration.sql`

- [ ] **Step 1: Add the column to the Prisma schema**

In `prisma/schema.prisma`, add a `heartbeatAt` field to `model ResearchStageJob`, after `startedAt` (line 470):

```prisma
  startedAt         DateTime?
  heartbeatAt       DateTime?
  completedAt       DateTime?
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260626220000_research_stage_heartbeat/migration.sql`:

```sql
-- Heartbeat for long-running research stage jobs (experiment stage)
ALTER TABLE "ResearchStageJob" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
```

- [ ] **Step 3: Apply to the local test DB and verify it compiles**

Run: `npx prisma generate`
Then: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-lifecycle.test.ts --no-file-parallelism --testTimeout 60000`
Expected: PASS (the `withPostgresTestDatabase` helper runs `db push`, picking up the new column).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260626220000_research_stage_heartbeat/migration.sql
git commit -m "feat: add heartbeatAt to ResearchStageJob"
```

---

## Task 4: Heartbeat-aware stale claim

**Files:**
- Modify: `src/lib/jobs/research.ts` (`claimNextResearchStageJob`, lines 62-114)
- Test: `tests/research-lifecycle.test.ts` (add a staleness test)

A live experiment heartbeats every ~60s, so reclaim must key off `coalesce(heartbeatAt, startedAt)` instead of `startedAt` alone.

- [ ] **Step 1: Write the failing test**

Add to `tests/research-lifecycle.test.ts` (inside the existing `claimNextResearchStageJob` describe, mirroring its setup):

```ts
it("does not reclaim a running job with a fresh heartbeat even if startedAt is old", async () => {
  await withPostgresTestDatabase(async (db) => {
    // seed a user + project + a running experiment job started 2h ago but heartbeated 1s ago
    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000);
    const justNow = new Date();
    // ...seed via db.researchStageJob.create with status:"running",
    //    claimedByWorkerId:"worker-A", startedAt: fortyMinAgo, heartbeatAt: justNow
    const claimed = await claimNextResearchStageJob({ userId, workerId: "worker-B" });
    expect(claimed).toBeNull();
  });
});

it("reclaims a running job whose heartbeat is stale", async () => {
  await withPostgresTestDatabase(async (db) => {
    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000);
    // ...seed running experiment job startedAt: fortyMinAgo, heartbeatAt: fortyMinAgo
    const claimed = await claimNextResearchStageJob({ userId, workerId: "worker-B" });
    expect(claimed?.claimedByWorkerId).toBe("worker-B");
  });
});

it("falls back to startedAt when heartbeatAt is null", async () => {
  await withPostgresTestDatabase(async (db) => {
    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000);
    // ...seed running experiment job startedAt: fortyMinAgo, heartbeatAt: null
    const claimed = await claimNextResearchStageJob({ userId, workerId: "worker-B" });
    expect(claimed?.claimedByWorkerId).toBe("worker-B");
  });
});
```

Fill the seed blocks following the existing seeding helpers in this test file (create user → generatedIdea → paper → researchProject → researchStageJob). Use `stageType: "experiment"` and ensure the project status is `running` (not aborted).

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-lifecycle.test.ts --no-file-parallelism --testTimeout 60000`
Expected: FAIL — the fresh-heartbeat job is wrongly reclaimed (current predicate uses `startedAt`).

- [ ] **Step 3: Update the reclaim predicate**

In `claimNextResearchStageJob`, replace BOTH `OR` arrays (the `findFirst` where on lines 70-73 and the `updateMany` where on lines 84-87) with the heartbeat-aware predicate:

```ts
        OR: [
          { status: "queued" },
          { status: "running", heartbeatAt: { lte: staleStartedBefore } },
          { status: "running", heartbeatAt: null, startedAt: { lte: staleStartedBefore } }
        ]
```

(Leave `staleStartedBefore = staleRunningJobStartedBefore()` as-is; it is the 30-min cutoff and is now compared against `heartbeatAt` when present.)

- [ ] **Step 4: Run to verify pass**

Run: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-lifecycle.test.ts --no-file-parallelism --testTimeout 60000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/research.ts tests/research-lifecycle.test.ts
git commit -m "feat: heartbeat-aware stale claim for research stage jobs"
```

---

## Task 5: Heartbeat helper + endpoint

**Files:**
- Modify: `src/lib/jobs/research.ts` (add `recordResearchStageHeartbeat`)
- Create: `src/app/api/workers/jobs/[jobId]/heartbeat/route.ts`
- Test: `tests/research-stage-heartbeat.test.ts` (create, Postgres)

- [ ] **Step 1: Write the failing test**

Create `tests/research-stage-heartbeat.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { recordResearchStageHeartbeat } from "@/lib/jobs/research";
import { withPostgresTestDatabase } from "./helpers/postgres";

describe("recordResearchStageHeartbeat", () => {
  it("updates heartbeatAt and reports not-aborted for a running job", async () => {
    await withPostgresTestDatabase(async (db) => {
      // seed user/idea/paper/project(status:"running")/stageJob(status:"running",
      //   claimedByWorkerId:"worker-A", stageType:"experiment", heartbeatAt:null)
      const result = await recordResearchStageHeartbeat({ jobId, workerId: "worker-A" });
      expect(result).toEqual({ aborted: false });
      const job = await db.researchStageJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.heartbeatAt).not.toBeNull();
    });
  });

  it("reports aborted when the project is aborted", async () => {
    await withPostgresTestDatabase(async (db) => {
      // seed project(status:"aborted") + running stageJob claimed by worker-A
      const result = await recordResearchStageHeartbeat({ jobId, workerId: "worker-A" });
      expect(result).toEqual({ aborted: true });
    });
  });

  it("returns null when the job is not claimed by this worker", async () => {
    await withPostgresTestDatabase(async (db) => {
      // seed running stageJob claimed by worker-A
      const result = await recordResearchStageHeartbeat({ jobId, workerId: "worker-OTHER" });
      expect(result).toBeNull();
    });
  });
});
```

Fill the seed blocks following `tests/research-lifecycle.test.ts`'s helpers.

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-stage-heartbeat.test.ts --no-file-parallelism --testTimeout 60000`
Expected: FAIL — `recordResearchStageHeartbeat` not exported.

- [ ] **Step 3: Add the helper**

In `src/lib/jobs/research.ts`, add (after `failResearchStageJob`, ~line 217):

```ts
export async function recordResearchStageHeartbeat(input: {
  jobId: string;
  workerId: string;
}): Promise<{ aborted: boolean } | null> {
  const job = await prisma.researchStageJob.findFirst({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    select: { researchProject: { select: { status: true } } }
  });

  if (!job) return null;

  await prisma.researchStageJob.updateMany({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    data: { heartbeatAt: new Date() }
  });

  return { aborted: job.researchProject.status === "aborted" };
}
```

- [ ] **Step 4: Add the route**

Create `src/app/api/workers/jobs/[jobId]/heartbeat/route.ts`, mirroring the auth skeleton from `complete/route.ts` (lines 19-36):

```ts
import { NextResponse } from "next/server";

import { findAllowedWorkerByToken } from "@/lib/auth/worker-token";
import { recordResearchStageHeartbeat } from "@/lib/jobs/research";
import { readBearerToken } from "@/lib/jobs/worker-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const worker = await findAllowedWorkerByToken(token);
  if (!worker) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.workerRegistration.update({
    where: { id: worker.id },
    data: { lastSeenAt: new Date() }
  });

  const { jobId } = await params;
  const result = await recordResearchStageHeartbeat({ jobId, workerId: worker.id });

  if (!result) {
    return NextResponse.json({ error: "Worker job is not running for this worker" }, { status: 404 });
  }

  return NextResponse.json(result);
}
```

> Confirm `export const dynamic = "force-dynamic"` matches the convention in `complete/route.ts` (copy whatever that file declares at the top).

- [ ] **Step 5: Run to verify pass**

Run: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-stage-heartbeat.test.ts --no-file-parallelism --testTimeout 60000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/research.ts "src/app/api/workers/jobs/[jobId]/heartbeat/route.ts" tests/research-stage-heartbeat.test.ts
git commit -m "feat: research stage heartbeat helper + endpoint"
```

---

## Task 6: Lanes + completion-route wiring

**Files:**
- Modify: `src/lib/workers/lanes.ts:6-19`
- Modify: `src/app/api/workers/jobs/[jobId]/complete/route.ts:12-17` (union), `156-166` (resolveJobType whitelist), `120-154` (markWorkerJobFailed)
- Test: `tests/worker-lanes.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/worker-lanes.test.ts`:

```ts
import { LANE_JOB_TYPES, WORKER_JOB_TYPES, laneClaimsJobType } from "@/lib/workers/lanes";

it("routes research_experiment to the research and both lanes", () => {
  expect(WORKER_JOB_TYPES).toContain("research_experiment");
  expect(laneClaimsJobType("research", "research_experiment")).toBe(true);
  expect(laneClaimsJobType("both", "research_experiment")).toBe(true);
  expect(laneClaimsJobType("inbox", "research_experiment")).toBe(false);
  expect(LANE_JOB_TYPES.research).toContain("research_experiment");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/worker-lanes.test.ts`
Expected: FAIL — `research_experiment` not in `WORKER_JOB_TYPES`.

- [ ] **Step 3: Update `lanes.ts`**

Replace `WORKER_JOB_TYPES` (lines 6-12) and `LANE_JOB_TYPES` (lines 15-19):

```ts
export const WORKER_JOB_TYPES = [
  "inbox_generation",
  "novelty_scan",
  "viability_check",
  "research_plan",
  "research_literature",
  "research_experiment"
] as const;
export type WorkerJobType = (typeof WORKER_JOB_TYPES)[number];

export const LANE_JOB_TYPES: Record<WorkerLane, readonly WorkerJobType[]> = {
  inbox: ["inbox_generation", "novelty_scan"],
  research: ["viability_check", "research_plan", "research_literature", "research_experiment"],
  both: [
    "inbox_generation",
    "novelty_scan",
    "viability_check",
    "research_plan",
    "research_literature",
    "research_experiment"
  ]
};
```

- [ ] **Step 4: Update `complete/route.ts`**

(a) Widen the union (lines 12-17):

```ts
type WorkerJobType =
  | "inbox_generation"
  | "novelty_scan"
  | "viability_check"
  | "research_plan"
  | "research_literature"
  | "research_experiment";
```

(b) In `resolveJobType` (lines 161-166), add `research_experiment` to the `requestedType` whitelist:

```ts
  const requestedType =
    input.requestedType === "inbox_generation" ||
    input.requestedType === "novelty_scan" ||
    input.requestedType === "viability_check" ||
    input.requestedType === "research_plan" ||
    input.requestedType === "research_literature" ||
    input.requestedType === "research_experiment"
      ? input.requestedType
      : null;
```

(c) In `markWorkerJobFailed` (line 138), add `research_experiment` to the research branch:

```ts
  } else if (
    input.jobType === "research_plan" ||
    input.jobType === "research_literature" ||
    input.jobType === "research_experiment"
  ) {
    await failResearchStageJob({ jobId: input.jobId, errorMessage: input.errorMessage });
```

(The completion success path needs no change — the final `else` already routes all research stages to `completeResearchStageJob`.)

- [ ] **Step 5: Run + typecheck**

Run: `npx vitest run tests/worker-lanes.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workers/lanes.ts "src/app/api/workers/jobs/[jobId]/complete/route.ts" tests/worker-lanes.test.ts
git commit -m "feat: wire research_experiment through lanes + completion route"
```

---

## Task 7: Claim route — buildExperimentJobInput

**Files:**
- Modify: `src/app/api/workers/claim/route.ts:134-154` (claim block dispatch) and add `buildExperimentJobInput` (after `buildLiteratureJobInput`, line 290)
- Test: `tests/research-worker-routes.test.ts` (extend, Postgres)

- [ ] **Step 1: Write the failing test**

Add to `tests/research-worker-routes.test.ts`, mirroring the existing "claims a research_literature job" test but seeding BOTH a `plan` and a `literature` artifact and a queued `experiment` stage job:

```ts
it("claims a research_experiment job and returns input with plan + literature", async () => {
  await withPostgresTestDatabase(async (db) => {
    // seed user/idea/paper/project(status:"running",currentStage:"experiment")
    // seed ResearchStageArtifact stageType:"plan" with a full ResearchPlan JSON
    // seed ResearchStageArtifact stageType:"literature" with a full LiteratureReview JSON
    // seed ResearchStageJob stageType:"experiment" status:"queued"
    // register a research-lane worker + token (reuse the helper used by the other tests)
    const res = await claimPost(token); // the helper the other tests use to call the claim route
    const body = await res.json();
    expect(body.job.type).toBe("research_experiment");
    expect(body.job.input.plan.hypotheses.length).toBeGreaterThan(0);
    expect(body.job.input.literature.gaps.length).toBeGreaterThan(0);
  });
});
```

Use the same harness the sibling tests use to invoke the claim route (they already exist for plan/literature in this file).

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-worker-routes.test.ts --no-file-parallelism --testTimeout 60000`
Expected: FAIL — the experiment job is dispatched to `buildResearchPlanJobInput` (the `else` branch), which produces the wrong shape / no `literature`.

- [ ] **Step 3: Add the dispatch branch**

In `src/app/api/workers/claim/route.ts`, update the lane check and dispatch block (lines 134-148). Add `research_experiment` to the lane condition and a third dispatch case:

```ts
  if (
    laneClaimsJobType(lane, "research_plan") ||
    laneClaimsJobType(lane, "research_literature") ||
    laneClaimsJobType(lane, "research_experiment")
  ) {
    const stageJob = await claimNextResearchStageJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (stageJob) {
      try {
        const input =
          stageJob.stageType === "experiment"
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

- [ ] **Step 4: Add `buildExperimentJobInput`**

After `buildLiteratureJobInput` (ends line 290), add:

```ts
async function buildExperimentJobInput(job: ClaimedResearchStageJob): Promise<ExperimentJobInput> {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;

  const planArtifact = job.researchProject.stageArtifacts.find((a) => a.stageType === "plan");
  if (!planArtifact) {
    throw new Error("Experiment stage requires a completed plan artifact");
  }
  const litArtifact = job.researchProject.stageArtifacts.find((a) => a.stageType === "literature");
  if (!litArtifact) {
    throw new Error("Experiment stage requires a completed literature artifact");
  }
  const plan = ResearchPlanSchema.parse(JSON.parse(planArtifact.artifactJson));
  const literature = LiteratureReviewSchema.parse(JSON.parse(litArtifact.artifactJson));

  let viability: ExperimentJobInput["viability"] = null;
  if (job.researchProject.sourceViabilityJobId) {
    const artifact = await prisma.artifact.findFirst({
      where: { jobId: job.researchProject.sourceViabilityJobId, kind: "viability-report" },
      orderBy: { createdAt: "desc" }
    });
    if (artifact) {
      viability = buildViabilityContextFromArtifactContent(artifact.content);
    }
  }

  return ExperimentJobInputSchema.parse({
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
      experimentalDesign: plan.experimentalDesign,
      protocolSteps: plan.protocolSteps,
      datasets: plan.datasets,
      baselines: plan.baselines,
      metrics: plan.metrics,
      successCriteria: plan.successCriteria
    },
    literature: {
      positioning: literature.positioning,
      gaps: literature.gaps
    },
    viability,
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    }))
  });
}
```

Add `ExperimentJobInput`, `ExperimentJobInputSchema`, and `LiteratureReviewSchema` to the `@/lib/v2/schemas` import (lines 17-21). `ResearchPlanSchema`, `parseJsonArray`, `buildViabilityContextFromArtifactContent`, and `prisma` are already imported.

- [ ] **Step 5: Run to verify pass**

Run: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-worker-routes.test.ts --no-file-parallelism --testTimeout 60000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/workers/claim/route.ts" tests/research-worker-routes.test.ts
git commit -m "feat: build experiment job input from plan + literature artifacts"
```

---

## Task 8: Agentic Codex runner

**Files:**
- Modify: `src/worker/codex-runner.ts`
- Test: `tests/codex-runner-agentic.test.ts` (create)

`runCodexAgentic` runs Codex with full-access flags targeting a workspace dir, streams its event log to `<workspace>/codex-run.log`, and is killable via an `AbortSignal` (tree-kill on Windows). It reuses `createCodexSpawnCommand` (the Windows cmd-shim logic) unchanged.

> **Spike (manual, do this once before relying on the flags):** with a real Codex install, run a throwaway prompt — "create `hello.py` that prints 7, run it, then output `{"ran":true,"value":7}` as your final message" — through `runCodexAgentic` and confirm Codex writes + executes + returns the JSON. If the full-access flag name differs on this install, adjust `buildCodexAgenticExecArgs` accordingly (the automated tests below assert the arg list, so update them to match).

- [ ] **Step 1: Write the failing test**

Create `tests/codex-runner-agentic.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { buildCodexAgenticExecArgs, runCodexAgentic } from "@/worker/codex-runner";

describe("buildCodexAgenticExecArgs", () => {
  it("runs codex with full access, targets the workspace, and keeps structured output", () => {
    const args = buildCodexAgenticExecArgs("/out/last.txt", "/work/exp");
    expect(args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--cd",
      "/work/exp",
      "--output-last-message",
      "/out/last.txt",
      "-"
    ]);
  });
});

describe("runCodexAgentic abort", () => {
  it("kills the child when the signal aborts and rejects", async () => {
    const kill = vi.fn();
    const fakeChild = {
      pid: 4321,
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill
    };
    const spawn = vi.fn(() => fakeChild);
    const controller = new AbortController();

    const promise = runCodexAgentic("/tmp/p.prompt.md", {
      workspaceDir: "/work/exp",
      spawn: spawn as never,
      readPromptFile: async () => "PROMPT",
      killChildTree: kill as never
    });

    controller.abort();
    // assert kill is invoked on abort; exact assertion depends on how the signal is wired
    await expect(promise).rejects.toBeTruthy();
    expect(kill).toHaveBeenCalled();
  });
});
```

> The abort test's exact wiring depends on the implementation in Step 3 (how the `AbortSignal` reaches the spawned child). Adjust the injected seams (`spawn`, `readPromptFile`, `killChildTree`, `signal`) to match Step 3 so the test drives the abort path deterministically without a real Codex.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/codex-runner-agentic.test.ts`
Expected: FAIL — `buildCodexAgenticExecArgs`/`runCodexAgentic` not exported.

- [ ] **Step 3: Implement the runner**

In `src/worker/codex-runner.ts`, add:

```ts
import { createWriteStream } from "node:fs";

export function buildCodexAgenticExecArgs(outputFile: string, workspaceDir: string) {
  return [
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--cd",
    workspaceDir,
    "--output-last-message",
    outputFile,
    "-"
  ];
}

function killChildTree(pid: number, platform: NodeJS.Platform) {
  if (platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
    } catch {
      // best effort
    }
  }
}

type RunCodexAgenticOptions = {
  workspaceDir: string;
  codexCommand?: string;
  platform?: NodeJS.Platform;
  spawn?: CodexSpawn;
  signal?: AbortSignal;
  logFile?: string;
};

export async function runCodexAgentic(
  promptFile: string,
  options: RunCodexAgenticOptions
): Promise<string> {
  const prompt = await readFile(promptFile, "utf8");
  const outputDir = await mkdtemp(join(dirname(promptFile), ".codex-output-"));
  const outputFile = join(outputDir, "last-message.txt");
  const logFile = options.logFile ?? join(options.workspaceDir, "codex-run.log");

  try {
    const args = buildCodexAgenticExecArgs(outputFile, options.workspaceDir);
    const platform = options.platform ?? process.platform;
    const commandPlan = createCodexSpawnCommand(
      options.codexCommand ?? getDefaultCodexCommand(platform),
      args,
      platform
    );
    const spawnCodex = options.spawn ?? (spawn as CodexSpawn);

    await new Promise<void>((resolve, reject) => {
      const child = spawnCodex(commandPlan.command, commandPlan.args, {
        ...commandPlan.options,
        cwd: options.workspaceDir,
        ...(commandPlan.envOverrides
          ? { env: { ...process.env, ...commandPlan.envOverrides } }
          : {}),
        stdio: ["pipe", "pipe", "pipe"]
      });

      const log = createWriteStream(logFile, { flags: "a" });
      let stderr = "";
      let settled = false;

      const onAbort = () => {
        if (typeof child.pid === "number") killChildTree(child.pid, platform);
        try {
          child.kill();
        } catch {
          // best effort
        }
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk) => log.write(String(chunk)));
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        log.write(text);
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", onAbort);
        log.end();
        reject(error);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", onAbort);
        log.end();
        if (options.signal?.aborted) {
          reject(new Error("codex run aborted"));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(buildFailureMessage(code, stderr, "")));
        }
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });

    return await readFile(outputFile, "utf8");
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}
```

> Adjust the injected seams to match the test's needs: expose `spawn`, `signal`, and `platform` as options (shown). If the test needs `readPromptFile`/`killChildTree` injection, add them as optional options and default them to `readFile`/the internal `killChildTree`. The `CodexChildProcess` type (lines 9-18) must gain an optional `pid?: number` and a `kill(): unknown` method — update that type accordingly.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/codex-runner-agentic.test.ts`
Expected: PASS.
Run: `npx vitest run tests/codex-runner.test.ts`
Expected: PASS (the existing `runCodex` is untouched).

- [ ] **Step 5: Commit**

```bash
git add src/worker/codex-runner.ts tests/codex-runner-agentic.test.ts
git commit -m "feat: add agentic Codex runner (full-access, workspace, abort-kill)"
```

---

## Task 9: Worker experiment executor

**Files:**
- Modify: `scripts/researchfinder-worker.ts`
- Modify: `.gitignore`
- Test: `tests/researchfinder-worker.test.ts` (extend)

`runExperimentJob` creates a per-experiment workspace, seeds `INPUT.json`, builds the prompt, runs `runCodexAgentic` while heartbeating, parses the result, and on abort fails the job cleanly (project stays `aborted`).

- [ ] **Step 1: Write the failing test**

Add to `tests/researchfinder-worker.test.ts`, mirroring the existing `runResearchFinderWorkerOnce` tests that inject a fake `runCodex`. Add an injected `runCodexAgentic` and a fake heartbeat:

```ts
it("runs a research_experiment job: seeds workspace, builds prompt, parses result", async () => {
  const validExperimentResultJson = JSON.stringify({
    researchProjectId: "proj-1",
    relationToSourcePaper: "Extends it.",
    implementationSummary: "Ran it.",
    environment: "python 3.11",
    hypothesisOutcomes: [{ hypothesis: "H1", outcome: "supported", evidence: "ok" }],
    metrics: [{ name: "acc", value: "0.9" }],
    findings: ["works"],
    limitations: [],
    artifacts: [{ path: "train.py", bytes: 10 }],
    logsExcerpt: "ran",
    reproductionSteps: ["uv run python train.py"],
    verdict: "success",
    summary: "done",
    citations: [
      { sourceType: "paper", url: "https://arxiv.org/abs/2401.00001", sourceId: "2401.00001",
        title: "Source Paper", claim: "extends", confidence: 0.9 }
    ]
  });

  const runCodexAgentic = vi.fn(async () => validExperimentResultJson);
  const fetchMock = makeClaimThenCompleteFetch({ jobType: "research_experiment", input: validExperimentInput });
  // validExperimentInput is an ExperimentJobInput object (see schema)

  await runResearchFinderWorkerOnce(config, {
    runCodexAgentic,
    fetch: fetchMock,
    maxIterations: 1
  } as never);

  expect(runCodexAgentic).toHaveBeenCalledTimes(1);
  // assert the prompt file passed to runCodexAgentic mentions the plan + literature
  // assert completeWorkerJob posted the parsed ExperimentResult
});
```

> Match the existing test harness in this file for how `fetch`/`runCodex` are injected and how claim+complete are stubbed. Add a `runCodexAgentic?` (and, if the heartbeat uses `fetch`, it is already injectable) seam to `WorkerRunOptions`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: FAIL — no `research_experiment` executor.

- [ ] **Step 3: Implement the executor**

In `scripts/researchfinder-worker.ts`:

(a) Imports — add to the `@/lib/v2/schemas` import block (lines 8-17):

```ts
  ExperimentJobInputSchema,
  type ExperimentJobInput,
```

and add:

```ts
import { runCodexAgentic as defaultRunCodexAgentic } from "@/worker/codex-runner";
```

(b) Extend `WorkerRunOptions` (lines 40-47) with:

```ts
  runCodexAgentic?: typeof defaultRunCodexAgentic;
  heartbeatMs?: number;
```

(c) Add the dispatch case in `runResearchFinderWorkerOnce` (after the `research_literature` block, ~line 230):

```ts
  if (payload.job.type === "research_experiment") {
    const result = await runExperimentJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }
```

(d) Add `research_experiment` to the `parseClaimPayload` whitelist (lines 354-360):

```ts
    job.type !== "research_plan" &&
    job.type !== "research_literature" &&
    job.type !== "research_experiment"
```

(e) Add the executor + helpers (near `runLiteratureJob`):

```ts
const DEFAULT_HEARTBEAT_MS = 60_000;

function parseExperimentJobInput(value: unknown) {
  try {
    return ExperimentJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(`Experiment job input failed validation: ${formatErrorMessage(error)}`);
  }
}

function experimentWorkspaceDir(researchProjectId: string) {
  const root =
    process.env.RESEARCHFINDER_EXPERIMENT_WORKSPACE_ROOT ??
    join(process.cwd(), ".research-workspaces");
  return join(root, researchProjectId, "experiment");
}

function buildExperimentPrompt(input: ExperimentJobInput) {
  return [
    "You are running a real, minimal research experiment in your current working directory.",
    "The full task input (idea, source paper, approved plan, literature positioning/gaps) is in INPUT.json in this directory — read it first.",
    "Implement and ACTUALLY RUN the smallest credible experiment that tests the plan's hypotheses:",
    "write code, install any dependencies you need, run it, and collect real metrics versus the baselines.",
    "When finished, output ONLY valid JSON matching the ExperimentResult schema as your final message. Do not wrap it in Markdown.",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    "Required keys: researchProjectId, relationToSourcePaper, implementationSummary, environment,",
    "hypothesisOutcomes (>=1, each {hypothesis, outcome: supported|refuted|inconclusive, evidence}),",
    "metrics (each {name, value, unit?, baseline?}), findings (>=1), limitations,",
    "artifacts (each {path, description?, bytes}), logsExcerpt, reproductionSteps (>=1),",
    "verdict (success|partial|failed), summary, citations (>=1).",
    "Ground in the source paper: relationToSourcePaper must explain how this work extends it,",
    'and citations MUST include the source paper as sourceType "paper" with its exact url and sourceId.',
    "If something fails, report it honestly with verdict \"partial\" or \"failed\" and explain in limitations."
  ].join("\n");
}

async function runExperimentJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseExperimentJobInput(job.input);
  const workspaceDir = experimentWorkspaceDir(input.researchProjectId);
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(join(workspaceDir, "INPUT.json"), JSON.stringify(input, null, 2), "utf8");

  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-experiment-"));
  const promptFile = join(promptDir, `${job.id}.prompt.md`);
  await writeFile(promptFile, buildExperimentPrompt(input), "utf8");

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
        workspaceDir,
        codexCommand: config.codexCommand,
        signal: controller.signal
      });
    } catch (error) {
      const message = controller.signal.aborted
        ? "Experiment aborted by user"
        : formatErrorMessage(error);
      await failWorkerJob(config, job, new Error(message));
      throw new ProcessedWorkerError(error);
    }

    try {
      return { output: parseResearchStageOutput("experiment", rawOutput) };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    clearInterval(heartbeat);
    await rm(promptDir, { force: true, recursive: true });
  }
}

async function sendWorkerHeartbeat(
  config: WorkerConfig,
  jobId: string
): Promise<{ aborted: boolean } | null> {
  const response = await fetch(
    `${normalizeAppUrl(config.appUrl)}/api/workers/jobs/${encodeURIComponent(jobId)}/heartbeat`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.workerToken}` }
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throwWorkerHttpError("heartbeat", response.status, await buildWorkerHttpErrorMessage("heartbeat", response));
  }
  return (await response.json()) as { aborted: boolean };
}
```

(f) Add `mkdir` to the `node:fs/promises` import (line 2):

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
```

(g) `.gitignore` — add a line:

```
.research-workspaces/
```

> The experiment workspace is intentionally NOT deleted (the user inspects it); only the temp prompt dir is cleaned. `sendWorkerHeartbeat` returning `null` (404) means the job is no longer running for this worker — the interval simply does nothing further that tick.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/researchfinder-worker.ts .gitignore tests/researchfinder-worker.test.ts
git commit -m "feat: worker experiment executor (agentic run + heartbeat + abort)"
```

---

## Task 10: Research detail UI — experiment section

**Files:**
- Modify: `src/app/research/[projectId]/page.tsx`
- Test: `tests/research-pages.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/research-pages.test.tsx`, mirroring the existing literature-rendering test but seeding an `experiment` artifact and asserting the section renders (verdict, a hypothesis outcome, a metric, a finding, a citation).

```ts
it("renders the experiment section when an experiment artifact exists", async () => {
  // mock getResearchProjectDetail to return stageArtifacts including stageType:"experiment"
  // with a valid ExperimentResult JSON
  // render the page, then:
  expect(await screen.findByText("Experiment")).toBeInTheDocument();
  expect(screen.getByText(/Hypothesis outcomes/i)).toBeInTheDocument();
});
```

Follow the existing mock pattern in this file for `getResearchProjectDetail`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/research-pages.test.tsx`
Expected: FAIL — no experiment section.

- [ ] **Step 3: Parse + render**

In `src/app/research/[projectId]/page.tsx`:

(a) Add `ExperimentResultSchema` to the `@/lib/v2/schemas` import (line 8).

(b) After the `literature` parse block (line 47), add:

```ts
  const expArtifact = artifactByStage.get("experiment");
  const experiment = expArtifact
    ? (() => {
        const r = ExperimentResultSchema.safeParse(JSON.parse(expArtifact.artifactJson));
        return r.success ? r.data : null;
      })()
    : null;
```

(c) After the literature `<section>` (line 182, the `) : null}` that closes it), add:

```tsx
        {experiment ? (
          <section className="mt-4 grid gap-4 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            <div>
              <h2 className="text-lg font-semibold text-rf-white">Experiment</h2>
              <p className="mt-1">
                <StatusBadge status={experiment.verdict} /> {experiment.summary}
              </p>
              <p className="mt-1">{experiment.relationToSourcePaper}</p>
            </div>
            <div>
              <h3 className="font-semibold text-rf-white">Implementation</h3>
              <p className="mt-1">{experiment.implementationSummary}</p>
              <p className="mt-1 text-rf-muted">Environment: {experiment.environment}</p>
            </div>
            <div>
              <h3 className="font-semibold text-rf-white">Hypothesis outcomes</h3>
              <ul className="mt-1 grid gap-2">
                {experiment.hypothesisOutcomes.map((outcome, index) => (
                  <li key={`${outcome.hypothesis}-${index}`}>
                    <span className="text-rf-white">{outcome.hypothesis}</span> —{" "}
                    <span className="uppercase">{outcome.outcome}</span>: {outcome.evidence}
                  </li>
                ))}
              </ul>
            </div>
            {experiment.metrics.length > 0 ? (
              <div>
                <h3 className="font-semibold text-rf-white">Metrics</h3>
                <ul className="mt-1 grid gap-1">
                  {experiment.metrics.map((metric, index) => (
                    <li key={`${metric.name}-${index}`}>
                      <span className="text-rf-white">{metric.name}</span>: {metric.value}
                      {metric.unit ? ` ${metric.unit}` : ""}
                      {metric.baseline ? ` (baseline ${metric.baseline})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <PlanList title="Findings" items={experiment.findings} />
            <PlanList title="Limitations" items={experiment.limitations} />
            <PlanList title="Reproduction steps" items={experiment.reproductionSteps} ordered />
            {experiment.artifacts.length > 0 ? (
              <div>
                <h3 className="font-semibold text-rf-white">Artifacts</h3>
                <ul className="mt-1 grid gap-1">
                  {experiment.artifacts.map((artifact, index) => (
                    <li key={`${artifact.path}-${index}`}>
                      <span className="text-rf-white">{artifact.path}</span>
                      {artifact.description ? ` — ${artifact.description}` : ""}{" "}
                      <span className="text-rf-muted">({artifact.bytes} bytes)</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <h3 className="font-semibold text-rf-white">Citations</h3>
              <ul className="mt-1 grid gap-1">
                {experiment.citations.map((citation, index) => (
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

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/research-pages.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/research/[projectId]/page.tsx" tests/research-pages.test.tsx
git commit -m "feat: render experiment results on the research detail page"
```

---

## Task 11: Full verification + final review

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + lint + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → 0 errors.
Run: `npm run build` → exit 0.

- [ ] **Step 2: Branch-relevant unit tests**

Run: `npx vitest run tests/experiment-schemas.test.ts tests/research-stages.test.ts tests/worker-lanes.test.ts tests/codex-runner-agentic.test.ts tests/codex-runner.test.ts tests/researchfinder-worker.test.ts tests/research-pages.test.tsx`
Expected: all PASS.

- [ ] **Step 3: Branch-relevant Postgres tests**

Run: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-lifecycle.test.ts tests/research-worker-routes.test.ts tests/research-stage-heartbeat.test.ts tests/research-stage-schema.test.ts tests/worker-lane-claim.test.ts --no-file-parallelism --testTimeout 60000`
Expected: all PASS. (If a file times out under contention, re-run it alone before treating it as a failure.)

- [ ] **Step 4: Manual spike (real Codex)**

Confirm `runCodexAgentic` actually drives Codex on the real install (see the spike note in Task 8). This is manual; it is not part of the automated suite.

- [ ] **Step 5: Final whole-branch review**

Dispatch a final code reviewer over the entire branch, then proceed to `superpowers:finishing-a-development-branch`.

- [ ] **Step 6: Post-merge**

After merge: `npm run db:deploy` on Neon to apply migration `20260626220000_research_stage_heartbeat`. Then smoke-test: "Develop this" on a viability-checked idea → plan → literature → experiment (a research-lane worker must be running) → experiment results render.
