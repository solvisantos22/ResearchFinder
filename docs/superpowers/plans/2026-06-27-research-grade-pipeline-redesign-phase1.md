# Research-Grade Pipeline Redesign — Phase 1 (Orchestration Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the forward-only stage advance with a producer→critic review-gated, backtracking state machine (caps + `needs_review` terminal), keeping the existing `plan→literature→experiment→analysis` stage set and analysis-PASS → `analysis_ready`; critics are thin Codex stubs this phase.

**Architecture:** Each producer stage job, on completion, persists its artifact and enqueues a `*_critic` job for the same stage. Each critic job returns a `CriticVerdict` (`PASS|REDO|BACKTRACK`); a pure router (`routeAfterCritic`) maps verdict + project budget counters to a deterministic action (enqueue next producer / re-enqueue same producer attempt+1 / backtrack & supersede downstream / set status). Producers and critics are both `runCodexAgentic` runs with heartbeat + abort; budgets stop infinite ping-pong and push exhausted projects to `needs_review` (artifacts + feedback preserved).

**Tech Stack:** Next.js 15 App Router, Prisma/Postgres, Zod, Vitest, tsx worker, Codex CLI.

---

## File Structure

| File | Phase-1 responsibility |
|------|------------------------|
| `prisma/schema.prisma` | Add `kind`, `attempt`, `feedback`, `verdictJson` to `ResearchStageJob`; drop its `@@unique([researchProjectId, stageType])`. Add `supersededAt` to `ResearchStageArtifact`; drop its `@@unique([researchProjectId, stageType])`. Add `producerRunsUsed`, `backtracksUsed` to `ResearchProject`. |
| `prisma/migrations/20260627120000_research_grade_orchestration/migration.sql` | Data-preserving migration: add columns with defaults (backfills existing rows), drop the two `@@unique` indexes. |
| `src/lib/v2/domain.ts` | Add `needs_review` to `RESEARCH_PROJECT_STATUSES` (status is a plain `String` column — no DB enum change needed). |
| `src/lib/research/stages.ts` | Add `stagesAfter(stage)` helper + `criticJobType(stage)` / `producerJobType(stage)` string helpers used by the orchestrator and lanes. |
| `src/lib/v2/schemas.ts` | Add `CriticVerdictSchema` (zod superRefine for conditional `targetStage`/`feedback`), export `CriticVerdict` type. |
| `src/worker/output-validation.ts` | Add `parseCriticVerdict(raw)`. |
| `src/lib/workers/lanes.ts` | Add the four `research_${stage}_critic` job types to `WORKER_JOB_TYPES`, `WorkerJobType`, `LANE_JOB_TYPES.research` + `.both`. |
| `src/app/api/workers/jobs/[jobId]/complete/route.ts` | Extend the DUPLICATED local `WorkerJobType` union + `resolveJobType` whitelist + `markWorkerJobFailed` branch for critic job types. |
| `scripts/researchfinder-worker.ts` | Extend the DUPLICATED `parseClaimPayload` whitelist; add `runStageCriticJob` (stub Codex run) + dispatch for each `research_${stage}_critic`. |
| `src/lib/research/router.ts` | NEW pure router `routeAfterCritic(verdict, project, jobMeta)` → `RouteAction`; exports caps `MAX_REDOS_PER_STAGE`, `MAX_BACKTRACKS`, `MAX_PRODUCER_RUNS`. |
| `src/lib/jobs/research.ts` | Rewrite `completeResearchStageJob` to: producer → persist artifact + enqueue critic; critic → validate `CriticVerdictSchema`, call `routeAfterCritic`, apply the action (enqueue jobs, supersede artifacts, set status, bump counters). |
| `src/app/api/workers/claim/route.ts` | Claim a `*_critic` job and build the critic input `{ researchProjectId, stageType, artifactToJudge, sourcePaper, criteria }`. |

### Cross-task name contract (keep identical everywhere)

- Job `kind` values: `"producer"` (default), `"critic"`.
- New `ResearchStageJob` columns: `kind`, `attempt`, `feedback`, `verdictJson`.
- New `ResearchStageArtifact` column: `supersededAt`.
- New `ResearchProject` columns: `producerRunsUsed`, `backtracksUsed`.
- New status: `needs_review`.
- Critic worker job type string: `research_${stage}_critic` (e.g. `research_plan_critic`).
- Schemas/parsers: `CriticVerdictSchema`, `CriticVerdict`, `parseCriticVerdict`.
- Router: `routeAfterCritic`, `RouteAction`, `MAX_REDOS_PER_STAGE = 3`, `MAX_BACKTRACKS = 5`, `MAX_PRODUCER_RUNS = 30`.
- Verdict enum values: `"PASS"`, `"REDO"`, `"BACKTRACK"` (uppercase, matching the spec).

### Testing notes (apply to every Postgres-backed task)

- Postgres tests (`research-lifecycle`, `research-worker-routes`) need a live DB. Set `TEST_DATABASE_URL` from `.env` but with port `54329`→`5432`:
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-lifecycle.test.ts --testTimeout=120000 --hookTimeout=120000
  ```
- The Postgres helper (`tests/helpers/postgres.ts`) runs `prisma db push` against a fresh schema per test, so it reads `prisma/schema.prisma` directly — the schema edits in Task 1 are what those tests pick up (the migration SQL is validated separately, see Task 1).
- Do NOT run the full 26-file suite (it hangs); run only the files a task touches.
- Pure router tests (`tests/research-router.test.ts`) and schema/lane/worker unit tests need NO DB: `npx vitest run tests/research-router.test.ts`.
- Type-check the whole repo after schema/type changes: `npx tsc --noEmit`.
- Regenerate the Prisma client after editing `schema.prisma`: `npx prisma generate` (required before `tsc` and the Postgres tests see the new fields).

---

## Task 1: Prisma model changes + data-preserving migration

**Files**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260627120000_research_grade_orchestration/migration.sql`

Today the two research tables both carry `@@unique([researchProjectId, stageType])`. That is incompatible with Phase 1: a stage now has a producer job AND a critic job (and re-attempts), and a stage can have multiple artifacts over its lifetime (backtrack supersedes the old one and keeps history). Both unique constraints must be dropped. The claim/complete code keys off the job `id`, never the composite unique, so dropping it does not change existing behavior.

- [ ] **Step 1 — Write the failing schema-shape test.** Add `tests/research-orchestration-schema.test.ts` proving the new columns exist and the unique constraints are gone, via Postgres `db push` + a write that would violate the old unique:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));
vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));
afterEach(() => {
  mocked.prisma = null;
});

async function seedProject(client: PrismaClient) {
  const user = await client.user.create({ data: { email: `orch-${Math.random()}@example.com` } });
  const paper = await client.paper.create({
    data: {
      arxivId: `2503.${Math.floor(Math.random() * 100000)}`,
      title: "Src",
      abstract: "A",
      url: "https://arxiv.org/abs/2503.00001",
      publishedAt: new Date(),
      arxivUpdatedAt: new Date(),
      authorsJson: "[]",
      categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id, paperId: paper.id, inboxDate: "2026-06-27", title: "T", summary: "S",
      expandedExplanation: "E", trajectory: "Tr", recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8, feasibilityScore: 0.8,
      overallScore: 0.8, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  return { user, project };
}

describe("research orchestration schema (Phase 1)", () => {
  it("defaults the new ResearchProject + ResearchStageJob columns", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, project } = await seedProject(client);
      const fresh = await client.researchProject.findUniqueOrThrow({ where: { id: project.id } });
      expect(fresh.producerRunsUsed).toBe(0);
      expect(fresh.backtracksUsed).toBe(0);

      const job = await client.researchStageJob.create({
        data: {
          researchProjectId: project.id, userId: user.id, stageType: "plan",
          status: "queued", inputJson: "{}"
        }
      });
      expect(job.kind).toBe("producer");
      expect(job.attempt).toBe(1);
      expect(job.feedback).toBeNull();
      expect(job.verdictJson).toBeNull();
    });
  });

  it("allows a producer AND a critic job for the same stage (old unique dropped)", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, project } = await seedProject(client);
      await client.researchStageJob.create({
        data: { researchProjectId: project.id, userId: user.id, stageType: "plan", kind: "producer", status: "completed", inputJson: "{}" }
      });
      await expect(
        client.researchStageJob.create({
          data: { researchProjectId: project.id, userId: user.id, stageType: "plan", kind: "critic", status: "queued", inputJson: "{}" }
        })
      ).resolves.toBeTruthy();
    });
  });

  it("allows multiple artifacts per stage with supersededAt (old unique dropped)", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { project } = await seedProject(client);
      await client.researchStageArtifact.create({
        data: { researchProjectId: project.id, stageType: "plan", artifactJson: "{}", supersededAt: new Date() }
      });
      await expect(
        client.researchStageArtifact.create({
          data: { researchProjectId: project.id, stageType: "plan", artifactJson: "{}" }
        })
      ).resolves.toBeTruthy();
      const live = await client.researchStageArtifact.findMany({
        where: { researchProjectId: project.id, stageType: "plan", supersededAt: null }
      });
      expect(live).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2 — Run it; expect FAIL** (columns/relaxed constraints don't exist yet):
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-orchestration-schema.test.ts --testTimeout=120000 --hookTimeout=120000
  ```
  Expected: failures like `Unknown argument 'kind'` / unique-constraint violation on the second create.

- [ ] **Step 3 — Edit `prisma/schema.prisma`.** Current `ResearchProject` block (lines 439–455) ends:
```prisma
model ResearchProject {
  id                   String    @id @default(cuid())
  userId               String
  generatedIdeaId      String
  sourceViabilityJobId String?
  status               String
  currentStage         String
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  ...
}
```
Add the two counters right after `currentStage`:
```prisma
  status               String
  currentStage         String
  producerRunsUsed     Int       @default(0)
  backtracksUsed       Int       @default(0)
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
```

Current `ResearchStageJob` block (lines 457–479). Add `kind`, `attempt`, `feedback`, `verdictJson` and **remove** the `@@unique([researchProjectId, stageType])`:
```prisma
model ResearchStageJob {
  id                String    @id @default(cuid())
  researchProjectId String
  userId            String
  stageType         String
  kind              String    @default("producer")
  attempt           Int       @default(1)
  status            String
  feedback          String?
  verdictJson       String?
  claimedByWorkerId String?
  inputJson         String
  outputJson        String?
  errorMessage      String?
  createdAt         DateTime  @default(now())
  startedAt         DateTime?
  heartbeatAt       DateTime?
  completedAt       DateTime?
  updatedAt         DateTime  @updatedAt

  researchProject ResearchProject @relation(fields: [researchProjectId], references: [id], onDelete: Cascade)
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status, createdAt, id])
  @@index([claimedByWorkerId, status])
}
```
(Delete the line `@@unique([researchProjectId, stageType])`.)

Current `ResearchStageArtifact` block (lines 481–491). Add `supersededAt` and **remove** the `@@unique`:
```prisma
model ResearchStageArtifact {
  id                String    @id @default(cuid())
  researchProjectId String
  stageType         String
  artifactJson      String
  supersededAt      DateTime?
  createdAt         DateTime  @default(now())

  researchProject ResearchProject @relation(fields: [researchProjectId], references: [id], onDelete: Cascade)

  @@index([researchProjectId, stageType])
}
```
(Replace `@@unique([researchProjectId, stageType])` with `@@index([researchProjectId, stageType])` so "latest live artifact per stage" lookups stay indexed.)

- [ ] **Step 4 — Write the migration SQL.** Create `prisma/migrations/20260627120000_research_grade_orchestration/migration.sql` (timestamp `20260627120000` is after the latest existing `20260627090000_launcher_restart_requested`). Defaults backfill every existing row; dropping the unique indexes preserves the rows:
```sql
-- Phase 1 orchestration spine: per-attempt + producer/critic tracking, backtrack supersession, budgets.

-- ResearchProject budget counters (backfills existing rows to 0 via DEFAULT)
ALTER TABLE "ResearchProject" ADD COLUMN "producerRunsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ResearchProject" ADD COLUMN "backtracksUsed" INTEGER NOT NULL DEFAULT 0;

-- ResearchStageJob: distinguish producer vs critic, per-attempt tracking, carried feedback, critic verdict
ALTER TABLE "ResearchStageJob" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'producer';
ALTER TABLE "ResearchStageJob" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ResearchStageJob" ADD COLUMN "feedback" TEXT;
ALTER TABLE "ResearchStageJob" ADD COLUMN "verdictJson" TEXT;

-- A stage now has a producer job AND a critic job (plus re-attempts); drop the one-job-per-stage unique.
DROP INDEX "ResearchStageJob_researchProjectId_stageType_key";

-- ResearchStageArtifact: backtracking supersedes downstream artifacts but keeps history.
ALTER TABLE "ResearchStageArtifact" ADD COLUMN "supersededAt" TIMESTAMP(3);
DROP INDEX "ResearchStageArtifact_researchProjectId_stageType_key";
CREATE INDEX "ResearchStageArtifact_researchProjectId_stageType_idx" ON "ResearchStageArtifact"("researchProjectId", "stageType");
```

- [ ] **Step 5 — Regenerate the client and re-run the schema test; expect PASS:**
  ```bash
  npx prisma generate
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-orchestration-schema.test.ts --testTimeout=120000 --hookTimeout=120000
  ```
  Expected: all 3 tests pass.

- [ ] **Step 6 — Guard against migration drift.** Confirm the SQL matches the schema (the migration is what prod runs; the test path uses `db push`):
  ```bash
  npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$TEST_DATABASE_URL" --exit-code
  ```
  Expected: exit code 0 (no drift). If it reports drift, reconcile the SQL with the schema and re-run.

- [ ] **Step 7 — Commit:**
  ```bash
  git add prisma/schema.prisma prisma/migrations/20260627120000_research_grade_orchestration tests/research-orchestration-schema.test.ts
  git commit -m "feat: orchestration data model (kind/attempt/feedback/verdict, supersededAt, budgets) + migration"
  ```

---

## Task 2: `needs_review` status + `stages.ts` helpers

**Files**
- Modify: `src/lib/v2/domain.ts`
- Modify: `src/lib/research/stages.ts`
- Create: `tests/research-stage-helpers.test.ts`

Status is a plain `String` column (see `ResearchProject.status String` in `schema.prisma`), so `needs_review` needs only the app-level enum. No `RESEARCH_PROJECT_STATUSES`-pinning test exists, so adding a member is safe.

- [ ] **Step 1 — Failing test.** Create `tests/research-stage-helpers.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { RESEARCH_PROJECT_STATUSES } from "@/lib/v2/domain";
import { stagesAfter, producerJobType, criticJobType } from "@/lib/research/stages";

describe("needs_review status", () => {
  it("is an allowed research project status", () => {
    expect(RESEARCH_PROJECT_STATUSES).toContain("needs_review");
  });
});

describe("stagesAfter", () => {
  it("returns executable stages strictly after the given stage, in order", () => {
    expect(stagesAfter("plan")).toEqual(["literature", "experiment", "analysis"]);
    expect(stagesAfter("experiment")).toEqual(["analysis"]);
    expect(stagesAfter("analysis")).toEqual([]);
  });
});

describe("job type helpers", () => {
  it("builds producer and critic worker job type strings", () => {
    expect(producerJobType("plan")).toBe("research_plan");
    expect(criticJobType("plan")).toBe("research_plan_critic");
    expect(criticJobType("analysis")).toBe("research_analysis_critic");
  });
});
```

- [ ] **Step 2 — Run it; expect FAIL:**
  ```bash
  npx vitest run tests/research-stage-helpers.test.ts
  ```
  Expected: `needs_review` not in array; `stagesAfter`/`producerJobType`/`criticJobType` are not exported.

- [ ] **Step 3 — Add `needs_review` to `src/lib/v2/domain.ts`.** Current block:
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
Add `needs_review` (append before `aborted` to keep terminal-ish statuses grouped):
```ts
export const RESEARCH_PROJECT_STATUSES = [
  "running",
  "plan_ready",
  "literature_ready",
  "experiment_ready",
  "analysis_ready",
  "needs_review",
  "aborted",
  "failed"
] as const;
```

- [ ] **Step 4 — Add helpers to `src/lib/research/stages.ts`.** Append after `nextExecutableStage` (keep `RESEARCH_STAGES`/`EXECUTABLE_STAGES` exactly as-is — `tests/research-stages.test.ts` pins them):
```ts
// Executable stages strictly after `stage`, in pipeline order. Used to supersede
// downstream artifacts on BACKTRACK and to find the next producer on PASS.
export function stagesAfter(stage: ResearchStage): ExecutableStage[] {
  const startIndex = RESEARCH_STAGES.indexOf(stage);
  const after: ExecutableStage[] = [];
  for (let i = startIndex + 1; i < RESEARCH_STAGES.length; i++) {
    const next = RESEARCH_STAGES[i];
    if ((EXECUTABLE_STAGES as readonly ResearchStage[]).includes(next)) {
      after.push(next as ExecutableStage);
    }
  }
  return after;
}

export function producerJobType(stage: ResearchStage): string {
  return `research_${stage}`;
}

export function criticJobType(stage: ResearchStage): string {
  return `research_${stage}_critic`;
}
```

- [ ] **Step 5 — Run the new test + the existing stages test; expect PASS:**
  ```bash
  npx vitest run tests/research-stage-helpers.test.ts tests/research-stages.test.ts
  ```
  Expected: both files green (the pin on `RESEARCH_STAGES`/`EXECUTABLE_STAGES` still holds).

- [ ] **Step 6 — Commit:**
  ```bash
  git add src/lib/v2/domain.ts src/lib/research/stages.ts tests/research-stage-helpers.test.ts
  git commit -m "feat: add needs_review status + stagesAfter/producerJobType/criticJobType helpers"
  ```

---

## Task 3: `CriticVerdictSchema` + `parseCriticVerdict`

**Files**
- Modify: `src/lib/v2/schemas.ts`
- Modify: `src/worker/output-validation.ts`
- Create: `tests/critic-verdict-schema.test.ts`

- [ ] **Step 1 — Failing test.** Create `tests/critic-verdict-schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { CriticVerdictSchema } from "@/lib/v2/schemas";
import { parseCriticVerdict } from "@/worker/output-validation";

const base = {
  researchProjectId: "proj-1",
  stageType: "plan",
  scorecard: [{ criterion: "Feasible here", pass: true, note: "Runs with Codex + public data." }]
};

describe("CriticVerdictSchema", () => {
  it("accepts a PASS verdict with no feedback or targetStage", () => {
    expect(CriticVerdictSchema.parse({ ...base, verdict: "PASS" })).toMatchObject({ verdict: "PASS" });
  });

  it("requires feedback when the verdict is REDO", () => {
    expect(CriticVerdictSchema.safeParse({ ...base, verdict: "REDO" }).success).toBe(false);
    expect(
      CriticVerdictSchema.safeParse({ ...base, verdict: "REDO", feedback: "Add seeds + ablations." }).success
    ).toBe(true);
  });

  it("requires both targetStage and feedback when the verdict is BACKTRACK", () => {
    expect(
      CriticVerdictSchema.safeParse({ ...base, verdict: "BACKTRACK", feedback: "Re-scope." }).success
    ).toBe(false);
    expect(
      CriticVerdictSchema.safeParse({ ...base, verdict: "BACKTRACK", targetStage: "plan", feedback: "Re-scope." }).success
    ).toBe(true);
  });

  it("rejects targetStage on a non-BACKTRACK verdict", () => {
    expect(
      CriticVerdictSchema.safeParse({ ...base, verdict: "PASS", targetStage: "plan" }).success
    ).toBe(false);
  });

  it("requires at least one scorecard entry", () => {
    expect(CriticVerdictSchema.safeParse({ ...base, verdict: "PASS", scorecard: [] }).success).toBe(false);
  });

  it("rejects unknown keys and unknown stage values", () => {
    expect(CriticVerdictSchema.safeParse({ ...base, verdict: "PASS", extra: 1 }).success).toBe(false);
    expect(CriticVerdictSchema.safeParse({ ...base, stageType: "nope", verdict: "PASS" }).success).toBe(false);
  });

  it("parseCriticVerdict parses a JSON string", () => {
    const raw = JSON.stringify({ ...base, verdict: "PASS" });
    expect(parseCriticVerdict(raw)).toMatchObject({ verdict: "PASS", stageType: "plan" });
  });
});
```

- [ ] **Step 2 — Run it; expect FAIL:**
  ```bash
  npx vitest run tests/critic-verdict-schema.test.ts
  ```
  Expected: `CriticVerdictSchema`/`parseCriticVerdict` are not exported.

- [ ] **Step 3 — Add `CriticVerdictSchema` to `src/lib/v2/schemas.ts`.** Place it after `AnalysisJobInputSchema` (and before the `export type` block near line 585). It reuses `strictObject`, `NonEmptyTrimmedStringSchema`, and the existing `RESEARCH_STAGES` from `@/lib/v2/domain`. First extend the domain import at the top of the file (current import is lines 3–9):
```ts
import {
  CALIBRATED_NOVELTY_LABELS,
  MAX_DAILY_IDEAS,
  MAX_IDEAS_PER_PAPER,
  NOVELTY_STATUSES,
  RESEARCH_STAGES,
  VIABILITY_VERDICTS
} from "@/lib/v2/domain";
```
Then add the schema:
```ts
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
```
Add the type export in the `export type` block (alongside `ResearchPlan`, etc.):
```ts
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;
```

- [ ] **Step 4 — Add `parseCriticVerdict` to `src/worker/output-validation.ts`.** Extend the import (current lines 2–10) to include `CriticVerdictSchema`:
```ts
import {
  AnalysisResultSchema,
  CriticVerdictSchema,
  ExperimentResultSchema,
  GeneratedInboxSchema,
  LiteratureReviewSchema,
  NoveltyScanResultSchema,
  ResearchPlanSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";
```
Append the parser (mirrors `parseResearchStageOutput`):
```ts
export function parseCriticVerdict(raw: string) {
  return CriticVerdictSchema.parse(JSON.parse(raw));
}
```

- [ ] **Step 5 — Run the test + type-check; expect PASS:**
  ```bash
  npx vitest run tests/critic-verdict-schema.test.ts && npx tsc --noEmit
  ```
  Expected: tests green, no type errors.

- [ ] **Step 6 — Commit:**
  ```bash
  git add src/lib/v2/schemas.ts src/worker/output-validation.ts tests/critic-verdict-schema.test.ts
  git commit -m "feat: CriticVerdictSchema (conditional targetStage/feedback) + parseCriticVerdict"
  ```

---

## Task 4: lanes.ts critic job types

**Files**
- Modify: `src/lib/workers/lanes.ts`
- Modify: `tests/worker-lanes.test.ts`

- [ ] **Step 1 — Add failing assertions to `tests/worker-lanes.test.ts`.** Append a new describe block:
```ts
describe("research critic lane mapping", () => {
  const criticTypes = [
    "research_plan_critic",
    "research_literature_critic",
    "research_experiment_critic",
    "research_analysis_critic"
  ] as const;

  it("registers each critic job type and routes it to research + both, not inbox", () => {
    for (const type of criticTypes) {
      expect(WORKER_JOB_TYPES).toContain(type);
      expect(LANE_JOB_TYPES.research).toContain(type);
      expect(LANE_JOB_TYPES.both).toContain(type);
      expect(laneClaimsJobType("research", type)).toBe(true);
      expect(laneClaimsJobType("both", type)).toBe(true);
      expect(laneClaimsJobType("inbox", type)).toBe(false);
    }
  });
});
```
Note: the existing `"LANE_JOB_TYPES.both lists all seven job types"` test will now be wrong (there are eleven). Update its title and expectation in the same edit:
```ts
  it("LANE_JOB_TYPES.both lists all eleven job types", () => {
    expect([...LANE_JOB_TYPES.both].sort()).toEqual(
      [
        "inbox_generation",
        "novelty_scan",
        "research_analysis",
        "research_analysis_critic",
        "research_experiment",
        "research_experiment_critic",
        "research_literature",
        "research_literature_critic",
        "research_plan",
        "research_plan_critic",
        "viability_check"
      ]
    );
  });
```

- [ ] **Step 2 — Run it; expect FAIL:**
  ```bash
  npx vitest run tests/worker-lanes.test.ts
  ```
  Expected: critic types missing from `WORKER_JOB_TYPES`/`LANE_JOB_TYPES`; the "eleven" array mismatches.

- [ ] **Step 3 — Edit `src/lib/workers/lanes.ts`.** Current `WORKER_JOB_TYPES` (lines 6–14) and `LANE_JOB_TYPES` (lines 17–21) become:
```ts
export const WORKER_JOB_TYPES = [
  "inbox_generation",
  "novelty_scan",
  "viability_check",
  "research_plan",
  "research_literature",
  "research_experiment",
  "research_analysis",
  "research_plan_critic",
  "research_literature_critic",
  "research_experiment_critic",
  "research_analysis_critic"
] as const;
export type WorkerJobType = (typeof WORKER_JOB_TYPES)[number];

export const LANE_JOB_TYPES: Record<WorkerLane, readonly WorkerJobType[]> = {
  inbox: ["inbox_generation", "novelty_scan"],
  research: [
    "viability_check",
    "research_plan",
    "research_literature",
    "research_experiment",
    "research_analysis",
    "research_plan_critic",
    "research_literature_critic",
    "research_experiment_critic",
    "research_analysis_critic"
  ],
  both: [
    "inbox_generation",
    "novelty_scan",
    "viability_check",
    "research_plan",
    "research_literature",
    "research_experiment",
    "research_analysis",
    "research_plan_critic",
    "research_literature_critic",
    "research_experiment_critic",
    "research_analysis_critic"
  ]
};
```

- [ ] **Step 4 — Run the test; expect PASS:**
  ```bash
  npx vitest run tests/worker-lanes.test.ts
  ```

- [ ] **Step 5 — Commit:**
  ```bash
  git add src/lib/workers/lanes.ts tests/worker-lanes.test.ts
  git commit -m "feat: register research_*_critic job types in worker lanes"
  ```

---

## Task 5: the two duplicated unions (complete route + worker `parseClaimPayload`) — explicit

These are the two spots that tripped earlier stages: each maintains its OWN job-type whitelist separate from `lanes.ts`. Both must learn the critic types. Doing this here (before the orchestrator/dispatch wiring) means later tasks can rely on critic completions and claims passing the whitelists.

**Files**
- Modify: `src/app/api/workers/jobs/[jobId]/complete/route.ts`
- Modify: `scripts/researchfinder-worker.ts`
- Create: `tests/research-complete-route-critic.test.ts`

- [ ] **Step 1 — Failing test for the complete route whitelist.** Create `tests/research-complete-route-critic.test.ts`. It proves a `*_critic` job can be resolved/failed by the complete route (full critic-completion routing is Task 7; here we only prove the whitelist + fail path accept the type). Mirror the existing Postgres-backed pattern from `tests/research-worker-routes.test.ts`:
```ts
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  worker: null as { id: string; userId: string; lane: string } | null
}));
vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));
vi.mock("@/lib/auth/worker-token", () => ({
  findAllowedWorkerByToken: async () => mocked.worker
}));
afterEach(() => {
  mocked.prisma = null;
  mocked.worker = null;
});

async function seedRunningCriticJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: `critic-${Math.random()}@example.com` } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w", tokenHash: "h", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: `2504.${Math.floor(Math.random() * 100000)}`, title: "Src", abstract: "A",
      url: "https://arxiv.org/abs/2504.00001", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id, paperId: paper.id, inboxDate: "2026-06-27", title: "T", summary: "S",
      expandedExplanation: "E", trajectory: "Tr", recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8, feasibilityScore: 0.8,
      overallScore: 0.8, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  const job = await client.researchStageJob.create({
    data: {
      researchProjectId: project.id, userId: user.id, stageType: "plan", kind: "critic",
      status: "running", claimedByWorkerId: worker.id, inputJson: "{}"
    }
  });
  return { user, worker, project, job };
}

describe("complete route accepts research critic job types", () => {
  it("marks a critic job failed when the worker reports an error", async () => {
    const { POST } = await import("@/app/api/workers/jobs/[jobId]/complete/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker, job } = await seedRunningCriticJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      const response = await POST(
        new Request(`http://localhost/api/workers/jobs/${job.id}/complete`, {
          method: "POST",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify({ type: "research_plan_critic", error: "codex crashed" })
        }),
        { params: Promise.resolve({ jobId: job.id }) }
      );
      expect(response.status).toBe(200);
      const updated = await client.researchStageJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(updated.status).toBe("failed");
    });
  });
});
```

- [ ] **Step 2 — Run it; expect FAIL:**
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-complete-route-critic.test.ts --testTimeout=120000 --hookTimeout=120000
  ```
  Expected: 404 "Worker job is not claimable by this worker" — `resolveJobType` rejects `research_plan_critic` because it is not in the whitelist, so the response is not 200.

- [ ] **Step 3 — Edit `src/app/api/workers/jobs/[jobId]/complete/route.ts`.** Three sub-edits in this one file.

  (a) The local `WorkerJobType` union (lines 12–19) gains the four critic types:
```ts
type WorkerJobType =
  | "inbox_generation"
  | "novelty_scan"
  | "viability_check"
  | "research_plan"
  | "research_literature"
  | "research_experiment"
  | "research_analysis"
  | "research_plan_critic"
  | "research_literature_critic"
  | "research_experiment_critic"
  | "research_analysis_critic";
```

  (b) `markWorkerJobFailed` research branch (lines 143–149) — extend it to route critic types to `failResearchStageJob` too:
```ts
  } else if (
    input.jobType === "research_plan" ||
    input.jobType === "research_literature" ||
    input.jobType === "research_experiment" ||
    input.jobType === "research_analysis" ||
    input.jobType === "research_plan_critic" ||
    input.jobType === "research_literature_critic" ||
    input.jobType === "research_experiment_critic" ||
    input.jobType === "research_analysis_critic"
  ) {
    await failResearchStageJob({ jobId: input.jobId, errorMessage: input.errorMessage });
  } else {
```

  (c) `resolveJobType` (lines 163–226). The `requestedType` whitelist (lines 168–177) gains the critic types, and the stage-job resolution at the end (lines 218–225) must build the right type from BOTH `stageType` and `kind`:
```ts
  const requestedType =
    input.requestedType === "inbox_generation" ||
    input.requestedType === "novelty_scan" ||
    input.requestedType === "viability_check" ||
    input.requestedType === "research_plan" ||
    input.requestedType === "research_literature" ||
    input.requestedType === "research_experiment" ||
    input.requestedType === "research_analysis" ||
    input.requestedType === "research_plan_critic" ||
    input.requestedType === "research_literature_critic" ||
    input.requestedType === "research_experiment_critic" ||
    input.requestedType === "research_analysis_critic"
      ? input.requestedType
      : null;
```
and the stage-job lookup (replace lines 218–225):
```ts
  const stageJob = await prisma.researchStageJob.findFirst({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    select: { stageType: true, kind: true }
  });

  if (!stageJob) return null;
  const stageJobType = (
    stageJob.kind === "critic"
      ? `research_${stageJob.stageType}_critic`
      : `research_${stageJob.stageType}`
  ) as WorkerJobType;
  return requestedType && requestedType !== stageJobType ? null : stageJobType;
```
The `complete` dispatch (lines 87–104) does NOT need a new branch: a critic completion still flows through the `else { await completeResearchStageJob(...) }` arm — `completeResearchStageJob` (rewritten in Task 7) branches on `job.kind` internally.

- [ ] **Step 4 — Run the complete-route test; expect PASS:**
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-complete-route-critic.test.ts --testTimeout=120000 --hookTimeout=120000
  ```

- [ ] **Step 5 — Extend `scripts/researchfinder-worker.ts` `parseClaimPayload` whitelist.** Current job-type check (lines 374–384) gains the four critic types:
```ts
  if (
    job.type !== "inbox_generation" &&
    job.type !== "novelty_scan" &&
    job.type !== "viability_check" &&
    job.type !== "research_plan" &&
    job.type !== "research_literature" &&
    job.type !== "research_experiment" &&
    job.type !== "research_analysis" &&
    job.type !== "research_plan_critic" &&
    job.type !== "research_literature_critic" &&
    job.type !== "research_experiment_critic" &&
    job.type !== "research_analysis_critic"
  ) {
    throw new FatalWorkerError(`Unsupported worker job type: ${String(job.type)}`);
  }
```
(The actual dispatch arm for critic types is added in Task 9; for now `parseClaimPayload` simply stops rejecting them so a claimed critic job is not a fatal error before its executor exists. Note: until Task 9, a claimed critic job would hit the `throw new FatalWorkerError("No local executor is registered...")` at the end of `runResearchFinderWorkerOnce` — that is fine because no critic job is enqueued until Task 7 wires the orchestrator, and Tasks 5/6/7/9 land before any worker runs against real data.)

- [ ] **Step 6 — Type-check; expect PASS:**
  ```bash
  npx tsc --noEmit
  ```

- [ ] **Step 7 — Commit:**
  ```bash
  git add src/app/api/workers/jobs/[jobId]/complete/route.ts scripts/researchfinder-worker.ts tests/research-complete-route-critic.test.ts
  git commit -m "feat: accept research_*_critic in the two duplicated job-type whitelists"
  ```

---

## Task 6: the pure `routeAfterCritic` router + unit tests (no DB)

This is the testable core of the state machine: a pure function from `(verdict, project counters, job metadata)` to a `RouteAction` describing what to enqueue / supersede / set. No Prisma, no `async`. Task 7 wires it into `completeResearchStageJob`.

**Files**
- Create: `src/lib/research/router.ts`
- Create: `tests/research-router.test.ts`

- [ ] **Step 1 — Failing test.** Create `tests/research-router.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import {
  routeAfterCritic,
  MAX_REDOS_PER_STAGE,
  MAX_BACKTRACKS,
  MAX_PRODUCER_RUNS
} from "@/lib/research/router";
import type { CriticVerdict } from "@/lib/v2/schemas";

const project = { producerRunsUsed: 0, backtracksUsed: 0 };

function verdict(partial: Partial<CriticVerdict> & Pick<CriticVerdict, "verdict">): CriticVerdict {
  return {
    researchProjectId: "proj-1",
    stageType: "plan",
    scorecard: [{ criterion: "c", pass: partial.verdict === "PASS", note: "n" }],
    ...partial
  } as CriticVerdict;
}

describe("routeAfterCritic — PASS", () => {
  it("advances to the next producer stage", () => {
    const action = routeAfterCritic(verdict({ verdict: "PASS", stageType: "plan" }), project, { attempt: 1 });
    expect(action).toEqual({ type: "enqueue_producer", stage: "literature", attempt: 1, feedback: null, incrementProducerRuns: true });
  });

  it("PASS on analysis (no next stage) terminates analysis_ready", () => {
    const action = routeAfterCritic(verdict({ verdict: "PASS", stageType: "analysis" }), project, { attempt: 1 });
    expect(action).toEqual({ type: "set_status", status: "analysis_ready" });
  });
});

describe("routeAfterCritic — REDO", () => {
  it("re-enqueues the same stage attempt+1 with feedback when under the per-stage cap", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "REDO", stageType: "plan", feedback: "Add seeds." }),
      project,
      { attempt: 1 }
    );
    expect(action).toEqual({ type: "enqueue_producer", stage: "plan", attempt: 2, feedback: "Add seeds.", incrementProducerRuns: true });
  });

  it("at the per-stage REDO cap, escalates by backtracking to the previous stage", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "REDO", stageType: "literature", feedback: "Still thin." }),
      { producerRunsUsed: 5, backtracksUsed: 0 },
      { attempt: MAX_REDOS_PER_STAGE }
    );
    expect(action).toEqual({
      type: "backtrack",
      targetStage: "plan",
      feedback: "Still thin.",
      supersedeAfter: "plan"
    });
  });

  it("at the REDO cap with no previous stage, sets needs_review", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "REDO", stageType: "plan", feedback: "No." }),
      project,
      { attempt: MAX_REDOS_PER_STAGE }
    );
    expect(action).toEqual({ type: "set_status", status: "needs_review" });
  });
});

describe("routeAfterCritic — BACKTRACK", () => {
  it("backtracks to the target stage and supersedes downstream when under caps", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "BACKTRACK", stageType: "experiment", targetStage: "plan", feedback: "Re-scope." }),
      { producerRunsUsed: 4, backtracksUsed: 1 },
      { attempt: 1 }
    );
    expect(action).toEqual({
      type: "backtrack",
      targetStage: "plan",
      feedback: "Re-scope.",
      supersedeAfter: "plan"
    });
  });

  it("sets needs_review when backtracks are exhausted", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "BACKTRACK", stageType: "experiment", targetStage: "plan", feedback: "Re-scope." }),
      { producerRunsUsed: 4, backtracksUsed: MAX_BACKTRACKS },
      { attempt: 1 }
    );
    expect(action).toEqual({ type: "set_status", status: "needs_review" });
  });

  it("sets needs_review when the total producer-run budget is exhausted", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "BACKTRACK", stageType: "experiment", targetStage: "plan", feedback: "Re-scope." }),
      { producerRunsUsed: MAX_PRODUCER_RUNS, backtracksUsed: 0 },
      { attempt: 1 }
    );
    expect(action).toEqual({ type: "set_status", status: "needs_review" });
  });

  it("PASS still terminates even at the producer-run cap (no new run needed)", () => {
    const action = routeAfterCritic(
      verdict({ verdict: "PASS", stageType: "analysis" }),
      { producerRunsUsed: MAX_PRODUCER_RUNS, backtracksUsed: MAX_BACKTRACKS },
      { attempt: 1 }
    );
    expect(action).toEqual({ type: "set_status", status: "analysis_ready" });
  });
});

describe("budget constants", () => {
  it("matches the spec defaults", () => {
    expect(MAX_REDOS_PER_STAGE).toBe(3);
    expect(MAX_BACKTRACKS).toBe(5);
    expect(MAX_PRODUCER_RUNS).toBe(30);
  });
});
```

- [ ] **Step 2 — Run it; expect FAIL:**
  ```bash
  npx vitest run tests/research-router.test.ts
  ```
  Expected: `@/lib/research/router` not found.

- [ ] **Step 3 — Implement `src/lib/research/router.ts`.** Pure, deterministic. The previous-stage lookup for REDO escalation walks `EXECUTABLE_STAGES` backward; `stagesAfter` supplies the "next producer" and the "supersede after" semantics. Note: on a successful new producer run, `producerRunsUsed` is incremented; PASS-advance also counts as launching a new producer (so `incrementProducerRuns: true`), but a PASS with no next stage (terminal) launches no producer and just sets status.
```ts
import {
  EXECUTABLE_STAGES,
  stagesAfter,
  type ExecutableStage,
  type ResearchStage
} from "@/lib/research/stages";
import type { ResearchProjectStatus } from "@/lib/v2/domain";
import type { CriticVerdict } from "@/lib/v2/schemas";

// Budgets exist only to stop infinite ping-pong; within them the loop grinds freely.
export const MAX_REDOS_PER_STAGE = 3;
export const MAX_BACKTRACKS = 5;
export const MAX_PRODUCER_RUNS = 30;

export type RouteAction =
  | {
      type: "enqueue_producer";
      stage: ExecutableStage;
      attempt: number;
      feedback: string | null;
      incrementProducerRuns: true;
    }
  | {
      type: "backtrack";
      targetStage: ExecutableStage;
      feedback: string;
      supersedeAfter: ExecutableStage;
    }
  | { type: "set_status"; status: ResearchProjectStatus };

type ProjectBudget = { producerRunsUsed: number; backtracksUsed: number };
type JobMeta = { attempt: number };

function previousExecutableStage(stage: ResearchStage): ExecutableStage | null {
  const index = (EXECUTABLE_STAGES as readonly ResearchStage[]).indexOf(stage);
  if (index <= 0) return null;
  return EXECUTABLE_STAGES[index - 1];
}

// Pure router: maps a critic verdict + the project's budget counters + the judged
// job's attempt to a single deterministic action. No DB, no side effects.
export function routeAfterCritic(
  verdict: CriticVerdict,
  project: ProjectBudget,
  jobMeta: JobMeta
): RouteAction {
  const stage = verdict.stageType as ExecutableStage;

  if (verdict.verdict === "PASS") {
    const [next] = stagesAfter(stage);
    if (!next) return { type: "set_status", status: "analysis_ready" };
    return {
      type: "enqueue_producer",
      stage: next,
      attempt: 1,
      feedback: null,
      incrementProducerRuns: true
    };
  }

  // REDO and BACKTRACK both want to launch another producer run: enforce the total cap first.
  if (project.producerRunsUsed >= MAX_PRODUCER_RUNS) {
    return { type: "set_status", status: "needs_review" };
  }

  if (verdict.verdict === "REDO") {
    // feedback is guaranteed present for non-PASS verdicts by CriticVerdictSchema.
    const feedback = verdict.feedback as string;
    if (jobMeta.attempt < MAX_REDOS_PER_STAGE) {
      return {
        type: "enqueue_producer",
        stage,
        attempt: jobMeta.attempt + 1,
        feedback,
        incrementProducerRuns: true
      };
    }
    // Per-stage REDO cap hit: escalate to a backtrack to the previous stage (root cause upstream).
    const previous = previousExecutableStage(stage);
    if (!previous || project.backtracksUsed >= MAX_BACKTRACKS) {
      return { type: "set_status", status: "needs_review" };
    }
    return { type: "backtrack", targetStage: previous, feedback, supersedeAfter: previous };
  }

  // BACKTRACK
  const targetStage = verdict.targetStage as ExecutableStage;
  const feedback = verdict.feedback as string;
  if (project.backtracksUsed >= MAX_BACKTRACKS) {
    return { type: "set_status", status: "needs_review" };
  }
  return { type: "backtrack", targetStage, feedback, supersedeAfter: targetStage };
}
```

- [ ] **Step 4 — Run the router test + type-check; expect PASS:**
  ```bash
  npx vitest run tests/research-router.test.ts && npx tsc --noEmit
  ```

- [ ] **Step 5 — Commit:**
  ```bash
  git add src/lib/research/router.ts tests/research-router.test.ts
  git commit -m "feat: pure routeAfterCritic state-machine router with budget caps"
  ```

---

## Task 7: wire the router into `completeResearchStageJob` (producer→critic + critic routing)

Rewrite `completeResearchStageJob` so it branches on `job.kind`:
- **producer**: validate output (existing schema + source-paper grounding) → persist artifact → enqueue THIS stage's critic (kind `critic`, status queued). It no longer advances the project or enqueues the next producer directly.
- **critic**: validate `CriticVerdictSchema` → persist `verdictJson` on the critic job → call `routeAfterCritic` → apply the `RouteAction` (enqueue producer / backtrack+supersede / set status), bumping `producerRunsUsed`/`backtracksUsed` as the action dictates. Abort-gating preserved via the conditional `updateMany` on `status: { not: "aborted" }`.

**Files**
- Modify: `src/lib/jobs/research.ts`
- Modify: `tests/research-lifecycle.test.ts`

- [ ] **Step 1 — Update the failing lifecycle tests.** The existing `completeResearchStageJob advance` tests assume producer completion advances the project directly. Under the new model, producer completion enqueues a critic instead. Rewrite the relevant assertions and add critic-routing tests. The shared seed/output helpers (`seedIdea`, `planOutput`, `literatureOutput`, `experimentOutput`, `analysisOutput`) stay as-is.

Add a critic-output helper near the other helpers:
```ts
function passVerdict(researchProjectId: string, stageType: string) {
  return {
    researchProjectId,
    stageType,
    verdict: "PASS" as const,
    scorecard: [{ criterion: "Phase-1 stub criteria", pass: true, note: "Stub critic passes." }]
  };
}

async function completePlanProducerAndClaimCritic(
  db: PrismaClient,
  ids: { user: { id: string }; idea: { id: string }; paper: { arxivId: string; url: string } }
) {
  await developIdea({ currentUserId: ids.user.id, generatedIdeaId: ids.idea.id });
  const plan = await claimNextResearchStageJob({ userId: ids.user.id, workerId: "w" });
  await completeResearchStageJob({
    jobId: plan!.id, workerId: "w", output: planOutput(plan!.researchProjectId, ids.paper)
  });
  return claimNextResearchStageJob({ userId: ids.user.id, workerId: "w" });
}
```
Replace the body of `"plan completion enqueues a literature job and sets the project running"` with the producer→critic expectation:
```ts
  it("plan producer completion enqueues a plan critic (not the next producer)", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      const critic = await completePlanProducerAndClaimCritic(db, {
        user, idea, paper: { arxivId: paper.arxivId, url: paper.url }
      });
      expect(critic?.stageType).toBe("plan");
      expect(critic?.kind).toBe("critic");
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: critic!.researchProjectId } });
      // Producer completion keeps the project on the plan stage, running.
      expect(project).toMatchObject({ currentStage: "plan", status: "running" });
      // No literature producer yet — only after the plan critic PASSes.
      const litJob = await db.researchStageJob.findFirst({ where: { researchProjectId: project.id, stageType: "literature" } });
      expect(litJob).toBeNull();
      const planArtifact = await db.researchStageArtifact.findFirst({ where: { researchProjectId: project.id, stageType: "plan", supersededAt: null } });
      expect(planArtifact).not.toBeNull();
    });
  });

  it("plan critic PASS enqueues the literature producer and advances the project", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      const critic = await completePlanProducerAndClaimCritic(db, {
        user, idea, paper: { arxivId: paper.arxivId, url: paper.url }
      });
      await completeResearchStageJob({
        jobId: critic!.id, workerId: "w", output: passVerdict(critic!.researchProjectId, "plan")
      });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: critic!.researchProjectId } });
      expect(project).toMatchObject({ currentStage: "literature", status: "running" });
      const litJob = await db.researchStageJob.findFirst({ where: { researchProjectId: project.id, stageType: "literature", kind: "producer", status: "queued" } });
      expect(litJob).not.toBeNull();
      expect(project.producerRunsUsed).toBe(1);
    });
  });

  it("plan critic REDO re-enqueues the plan producer attempt+1 with feedback", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      const critic = await completePlanProducerAndClaimCritic(db, {
        user, idea, paper: { arxivId: paper.arxivId, url: paper.url }
      });
      await completeResearchStageJob({
        jobId: critic!.id, workerId: "w",
        output: { ...passVerdict(critic!.researchProjectId, "plan"), verdict: "REDO", scorecard: [{ criterion: "Rigor", pass: false, note: "Add seeds." }], feedback: "Add seeds + ablations." }
      });
      const redo = await db.researchStageJob.findFirst({
        where: { researchProjectId: critic!.researchProjectId, stageType: "plan", kind: "producer", status: "queued" }
      });
      expect(redo).not.toBeNull();
      expect(redo!.attempt).toBe(2);
      expect(redo!.feedback).toBe("Add seeds + ablations.");
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: critic!.researchProjectId } });
      expect(project.producerRunsUsed).toBe(1);
    });
  });

  it("experiment critic BACKTRACK to plan supersedes downstream artifacts and re-enqueues plan", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      // Drive the loop to a claimed experiment critic by PASSing plan + literature critics,
      // then completing the experiment producer.
      // (Use a helper that PASSes each critic — see advanceWithPassingCritics below.)
      const expCritic = await advanceToExperimentCriticClaim(db, { user, idea, paper: { arxivId: paper.arxivId, url: paper.url } });
      expect(expCritic?.stageType).toBe("experiment");
      expect(expCritic?.kind).toBe("critic");
      await completeResearchStageJob({
        jobId: expCritic!.id, workerId: "w",
        output: { researchProjectId: expCritic!.researchProjectId, stageType: "experiment", verdict: "BACKTRACK", targetStage: "plan", feedback: "Toy data; re-scope.", scorecard: [{ criterion: "Real data", pass: false, note: "_style_micro toy fixtures." }] }
      });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: expCritic!.researchProjectId } });
      expect(project).toMatchObject({ currentStage: "plan", status: "running" });
      expect(project.backtracksUsed).toBe(1);
      // Experiment + literature artifacts after `plan` are superseded; plan artifact is still live.
      const liveExp = await db.researchStageArtifact.findFirst({ where: { researchProjectId: project.id, stageType: "experiment", supersededAt: null } });
      expect(liveExp).toBeNull();
      const livePlan = await db.researchStageArtifact.findFirst({ where: { researchProjectId: project.id, stageType: "plan", supersededAt: null } });
      expect(livePlan).not.toBeNull();
      const replan = await db.researchStageJob.findFirst({ where: { researchProjectId: project.id, stageType: "plan", kind: "producer", status: "queued" } });
      expect(replan).not.toBeNull();
      expect(replan!.attempt).toBe(2);
    });
  });
```
Add the `advanceToExperimentCriticClaim` helper near the other advance helpers (it PASSes each critic along the way):
```ts
async function passCriticAndClaimNext(
  db: PrismaClient,
  ids: { user: { id: string } },
  criticJob: { id: string; researchProjectId: string; stageType: string }
) {
  await completeResearchStageJob({
    jobId: criticJob.id, workerId: "w",
    output: passVerdict(criticJob.researchProjectId, criticJob.stageType)
  });
  return claimNextResearchStageJob({ userId: ids.user.id, workerId: "w" });
}

async function advanceToExperimentCriticClaim(
  db: PrismaClient,
  ids: { user: { id: string }; idea: { id: string }; paper: { arxivId: string; url: string } }
) {
  // plan producer -> plan critic
  const planCritic = await completePlanProducerAndClaimCritic(db, ids);
  // plan critic PASS -> literature producer
  const litProducer = await passCriticAndClaimNext(db, ids, planCritic!);
  await completeResearchStageJob({ jobId: litProducer!.id, workerId: "w", output: literatureOutput(litProducer!.researchProjectId, ids.paper) });
  // literature critic
  const litCritic = await claimNextResearchStageJob({ userId: ids.user.id, workerId: "w" });
  // literature critic PASS -> experiment producer
  const expProducer = await passCriticAndClaimNext(db, ids, litCritic!);
  await completeResearchStageJob({ jobId: expProducer!.id, workerId: "w", output: experimentOutput(expProducer!.researchProjectId, ids.paper) });
  // experiment critic
  return claimNextResearchStageJob({ userId: ids.user.id, workerId: "w" });
}
```
Also update the `"analysis completion sets the project analysis_ready"` test so it routes through critics: after the analysis producer completes, claim+PASS the analysis critic, then assert `analysis_ready`. The existing source-paper-citation rejection tests stay valid (they test producer-output validation, which is unchanged). The `"abort blocks advancement"` test stays valid against the producer path: an aborted project must not get a critic job enqueued — update its final assertion to check for the absence of a plan critic job:
```ts
      const planCritic = await db.researchStageJob.findFirst({ where: { researchProjectId: project.id, stageType: "plan", kind: "critic" } });
      expect(planCritic).toBeNull();
```

Note for the analysis-claim helpers (`advanceToExperimentClaim`/`advanceToAnalysisClaim`): these are used by the source-paper-citation rejection tests and now must PASS the intermediate critics. Update `advanceToExperimentClaim` to mirror `advanceToExperimentCriticClaim` but return the experiment PRODUCER claim (PASS plan + literature critics, claim the experiment producer), and `advanceToAnalysisClaim` to PASS the experiment critic then claim the analysis producer.

- [ ] **Step 2 — Run the lifecycle tests; expect FAIL** (current code advances the project on producer completion instead of enqueuing a critic):
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-lifecycle.test.ts --testTimeout=120000 --hookTimeout=120000
  ```

- [ ] **Step 3 — Rewrite `completeResearchStageJob` in `src/lib/jobs/research.ts`.** Extend the imports (current line 4) to add the router + verdict schema, and update the `include` in the claim/complete reads to surface `kind`/`attempt`/budget counters. New imports:
```ts
import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";
import {
  EXECUTABLE_STAGES,
  STAGE_REGISTRY,
  criticJobType,
  nextExecutableStage,
  stagesAfter,
  type ExecutableStage,
  type ResearchStage
} from "@/lib/research/stages";
import { routeAfterCritic } from "@/lib/research/router";
import { type Citation, CriticVerdictSchema, ViabilityResultSchema } from "@/lib/v2/schemas";
```
Replace the whole `completeResearchStageJob` function (current lines 118–198) with the kind-branching version:
```ts
export async function completeResearchStageJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  await prisma.$transaction(async (tx) => {
    const job = await tx.researchStageJob.findFirst({
      where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
      include: {
        researchProject: { include: { generatedIdea: { include: { paper: true } } } }
      }
    });

    if (!job) {
      throw new Error("Research stage job is no longer running");
    }

    if (job.kind === "critic") {
      await completeCriticJob(tx, job, input);
      return;
    }

    await completeProducerJob(tx, job, input);
  });
}

type CompleteTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type LoadedStageJob = Awaited<ReturnType<typeof loadStageJobForCompletion>>;

// (helper kept inline below; declared for the type alias only)
async function loadStageJobForCompletion(tx: CompleteTx, jobId: string, workerId: string) {
  return tx.researchStageJob.findFirst({
    where: { id: jobId, claimedByWorkerId: workerId, status: "running" },
    include: { researchProject: { include: { generatedIdea: { include: { paper: true } } } } }
  });
}

async function completeProducerJob(
  tx: CompleteTx,
  job: NonNullable<LoadedStageJob>,
  input: { jobId: string; workerId: string; output: unknown }
) {
  const stage = job.stageType as ResearchStage;
  const definition = STAGE_REGISTRY[stage as ExecutableStage];
  if (!definition) {
    throw new Error(`No registry entry for research stage "${job.stageType}"`);
  }

  const parsed = definition.outputSchema.parse(input.output) as {
    researchProjectId: string;
    citations: Citation[];
  };

  if (parsed.researchProjectId !== job.researchProjectId) {
    throw new Error("Research stage output does not match the claimed project");
  }

  if (definition.requiresSourcePaperCitation) {
    const sourcePaper = job.researchProject.generatedIdea.paper;
    assertCitesSourcePaper(parsed.citations, {
      id: sourcePaper.id,
      arxivId: sourcePaper.arxivId,
      url: sourcePaper.url
    });
  }

  const completion = await tx.researchStageJob.updateMany({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    data: { status: "completed", outputJson: JSON.stringify(parsed), completedAt: new Date() }
  });
  if (completion.count !== 1) {
    throw new Error("Research stage job is no longer running");
  }

  // Abort-safe: gate the critic enqueue on the project still being non-aborted.
  const advance = await tx.researchProject.updateMany({
    where: { id: job.researchProjectId, status: { not: "aborted" } },
    data: { currentStage: stage, status: "running" }
  });
  if (advance.count !== 1) {
    return; // aborted concurrently: record the completed job, but persist nothing further
  }

  // Supersede any prior live artifact for this stage, then persist the fresh one.
  await tx.researchStageArtifact.updateMany({
    where: { researchProjectId: job.researchProjectId, stageType: stage, supersededAt: null },
    data: { supersededAt: new Date() }
  });
  await tx.researchStageArtifact.create({
    data: { researchProjectId: job.researchProjectId, stageType: stage, artifactJson: JSON.stringify(parsed) }
  });

  // Enqueue the critic for this stage.
  await tx.researchStageJob.create({
    data: {
      researchProjectId: job.researchProjectId,
      userId: job.userId,
      stageType: stage,
      kind: "critic",
      status: "queued",
      inputJson: JSON.stringify({ researchProjectId: job.researchProjectId, stageType: stage })
    }
  });
}

async function completeCriticJob(
  tx: CompleteTx,
  job: NonNullable<LoadedStageJob>,
  input: { jobId: string; workerId: string; output: unknown }
) {
  const verdict = CriticVerdictSchema.parse(input.output);
  if (verdict.researchProjectId !== job.researchProjectId) {
    throw new Error("Critic verdict does not match the claimed project");
  }
  if (verdict.stageType !== job.stageType) {
    throw new Error("Critic verdict stage does not match the claimed critic job");
  }

  const completion = await tx.researchStageJob.updateMany({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    data: { status: "completed", verdictJson: JSON.stringify(verdict), completedAt: new Date() }
  });
  if (completion.count !== 1) {
    throw new Error("Research stage job is no longer running");
  }

  const action = routeAfterCritic(
    verdict,
    {
      producerRunsUsed: job.researchProject.producerRunsUsed,
      backtracksUsed: job.researchProject.backtracksUsed
    },
    { attempt: job.attempt }
  );

  if (action.type === "set_status") {
    // Abort-safe: never resurrect an aborted project.
    await tx.researchProject.updateMany({
      where: { id: job.researchProjectId, status: { not: "aborted" } },
      data: { status: action.status }
    });
    return;
  }

  if (action.type === "enqueue_producer") {
    const advance = await tx.researchProject.updateMany({
      where: { id: job.researchProjectId, status: { not: "aborted" } },
      data: { currentStage: action.stage, status: "running", producerRunsUsed: { increment: 1 } }
    });
    if (advance.count !== 1) return;
    await tx.researchStageJob.create({
      data: {
        researchProjectId: job.researchProjectId,
        userId: job.userId,
        stageType: action.stage,
        kind: "producer",
        attempt: action.attempt,
        feedback: action.feedback,
        status: "queued",
        inputJson: JSON.stringify({ researchProjectId: job.researchProjectId })
      }
    });
    return;
  }

  // action.type === "backtrack"
  const advance = await tx.researchProject.updateMany({
    where: { id: job.researchProjectId, status: { not: "aborted" } },
    data: {
      currentStage: action.targetStage,
      status: "running",
      producerRunsUsed: { increment: 1 },
      backtracksUsed: { increment: 1 }
    }
  });
  if (advance.count !== 1) return;

  // Supersede every live artifact for stages strictly after the target.
  const downstream = stagesAfter(action.supersedeAfter);
  if (downstream.length > 0) {
    await tx.researchStageArtifact.updateMany({
      where: {
        researchProjectId: job.researchProjectId,
        stageType: { in: downstream },
        supersededAt: null
      },
      data: { supersededAt: new Date() }
    });
  }

  await tx.researchStageJob.create({
    data: {
      researchProjectId: job.researchProjectId,
      userId: job.userId,
      stageType: action.targetStage,
      kind: "producer",
      attempt: job.attempt + 1,
      feedback: action.feedback,
      status: "queued",
      inputJson: JSON.stringify({ researchProjectId: job.researchProjectId })
    }
  });
}
```
Two supporting changes in the same file:
1. `claimNextResearchStageJob` (lines 62–116) must also claim critic jobs. Its `where` filters `stageType: { in: [...EXECUTABLE_STAGES] }` — that still matches critic jobs (a critic job's `stageType` is one of the executable stages; only its `kind` differs), so NO change is needed to the filter. Confirm by inspection; the claim already returns the full row including `kind`/`attempt`.
2. `nextExecutableStage` import becomes unused inside `completeResearchStageJob` but is still used elsewhere? Search the file: it is only used in the old advance logic. Remove `nextExecutableStage` from the import if `tsc` flags it unused (the router now owns advancement). Keep `EXECUTABLE_STAGES` (used by `claimNextResearchStageJob`).

- [ ] **Step 4 — Run the lifecycle tests; expect PASS:**
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-lifecycle.test.ts --testTimeout=120000 --hookTimeout=120000
  ```
  Expected: all lifecycle tests green.

- [ ] **Step 5 — Type-check; expect PASS:**
  ```bash
  npx tsc --noEmit
  ```
  If `tsc` reports `CompleteTx`/`LoadedStageJob` typing friction with `Prisma.TransactionClient`, simplify by importing `Prisma` from `@prisma/client` and typing the tx param as `Prisma.TransactionClient`, and type `job` as the resolved value of the inline `findFirst` (extract it to a named query). Keep behavior identical.

- [ ] **Step 6 — Commit:**
  ```bash
  git add src/lib/jobs/research.ts tests/research-lifecycle.test.ts
  git commit -m "feat: producer->critic enqueue + routeAfterCritic state machine in completeResearchStageJob"
  ```

---

## Task 8: claim route critic input builder

When the claim route claims a critic job (`kind === "critic"`), it must build a critic input `{ researchProjectId, stageType, artifactToJudge, sourcePaper, criteria }` where `artifactToJudge` is the latest LIVE producer artifact for that stage, `sourcePaper` carries the grounding paper, and `criteria` is a Phase-1 placeholder string. The returned job `type` is `research_${stageType}_critic`.

**Files**
- Modify: `src/app/api/workers/claim/route.ts`
- Modify: `tests/research-worker-routes.test.ts`

- [ ] **Step 1 — Failing test.** In `tests/research-worker-routes.test.ts`, add a seeder + test that seeds a project with a completed `plan` artifact and a queued `plan` critic job, then asserts the claim returns a critic input. Add after the existing analysis describe:
```ts
async function seedProjectWithPlanCriticJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "worker-routes-critic@example.com" } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w-critic", tokenHash: "h-critic", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: "2502.00006", title: "Critic Src", abstract: "E",
      url: "https://arxiv.org/abs/2502.00006", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id, paperId: paper.id, inboxDate: "2026-06-25", title: "Critic Idea", summary: "S",
      expandedExplanation: "E", trajectory: "Tr", recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8, feasibilityScore: 0.8,
      overallScore: 0.8, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  const planArtifact = {
    researchProjectId: project.id, relationToSourcePaper: "Builds on source paper",
    hypotheses: ["Hypothesis A"], experimentalDesign: "Run experiments", protocolSteps: ["Step 1"],
    datasets: [], baselines: [], metrics: ["Accuracy"], successCriteria: ["Beats baseline"],
    computeEstimate: "1 GPU day", risks: [],
    citations: [{ sourceType: "paper", title: "Source Paper", url: "https://arxiv.org/abs/2502.00006", sourceId: "2502.00006", claim: "Foundational", confidence: 0.9 }]
  };
  await client.researchStageArtifact.create({
    data: { researchProjectId: project.id, stageType: "plan", artifactJson: JSON.stringify(planArtifact) }
  });
  await client.researchStageJob.create({
    data: { researchProjectId: project.id, userId: user.id, stageType: "plan", kind: "critic", status: "queued", inputJson: JSON.stringify({ researchProjectId: project.id, stageType: "plan" }) }
  });
  return { user, worker, paper, project };
}

describe("research critic worker routes", () => {
  it("claims a plan critic job and returns a critic input with the artifact to judge", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithPlanCriticJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      const response = await POST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST", headers: { authorization: "Bearer t" }
        })
      );
      const payload = (await response.json()) as {
        job: {
          type: string;
          input: {
            researchProjectId: string;
            stageType: string;
            artifactToJudge: { hypotheses: string[] };
            sourcePaper: { arxivId: string };
            criteria: string;
          };
        };
      };
      expect(payload.job.type).toBe("research_plan_critic");
      expect(payload.job.input.stageType).toBe("plan");
      expect(payload.job.input.artifactToJudge.hypotheses.length).toBeGreaterThan(0);
      expect(payload.job.input.sourcePaper.arxivId).toBe("2502.00006");
      expect(payload.job.input.criteria).toContain("Phase 2");
    });
  });
});
```

- [ ] **Step 2 — Run it; expect FAIL** (claim route builds a producer input, not a critic input; for a critic job it would currently call `buildResearchPlanJobInput` and return `type: research_plan`):
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
  ```

- [ ] **Step 3 — Edit `src/app/api/workers/claim/route.ts`.** First, widen the lane gate that triggers stage-job claiming (lines 140–145) to include the critic lanes (so a research worker actually attempts a claim when only critic jobs are queued):
```ts
  if (
    laneClaimsJobType(lane, "research_plan") ||
    laneClaimsJobType(lane, "research_literature") ||
    laneClaimsJobType(lane, "research_experiment") ||
    laneClaimsJobType(lane, "research_analysis") ||
    laneClaimsJobType(lane, "research_plan_critic") ||
    laneClaimsJobType(lane, "research_literature_critic") ||
    laneClaimsJobType(lane, "research_experiment_critic") ||
    laneClaimsJobType(lane, "research_analysis_critic")
  ) {
```
Then branch on `kind` when building the input and the job type (replace lines 151–168):
```ts
    if (stageJob) {
      try {
        if (stageJob.kind === "critic") {
          const input = buildStageCriticJobInput(stageJob);
          return NextResponse.json({
            job: { type: `research_${stageJob.stageType}_critic`, id: stageJob.id, input }
          });
        }

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
```
Add the builder near the other `build*JobInput` functions. It reads the latest LIVE artifact for the critic's stage from the eager-loaded `stageArtifacts` (claim already includes `stageArtifacts: true`):
```ts
function buildStageCriticJobInput(job: ClaimedResearchStageJob) {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;
  const stage = job.stageType;

  const liveArtifact = job.researchProject.stageArtifacts
    .filter((a) => a.stageType === stage && a.supersededAt === null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!liveArtifact) {
    throw new Error(`Critic stage requires a live ${stage} artifact to judge`);
  }

  return {
    researchProjectId: job.researchProjectId,
    stageType: stage,
    artifactToJudge: JSON.parse(liveArtifact.artifactJson) as unknown,
    sourcePaper: {
      id: paper.id,
      arxivId: paper.arxivId,
      title: paper.title,
      abstract: paper.abstract,
      url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    criteria: `${stage} criteria placeholder — Phase 2 fills this in`
  };
}
```

- [ ] **Step 4 — Run the worker-routes test; expect PASS:**
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
  ```
  Expected: the new critic test plus all existing producer-claim tests pass (producer claims are unaffected — `kind` defaults to `"producer"` on the existing seeders, which omit `kind`).

- [ ] **Step 5 — Type-check; expect PASS:**
  ```bash
  npx tsc --noEmit
  ```

- [ ] **Step 6 — Commit:**
  ```bash
  git add src/app/api/workers/claim/route.ts tests/research-worker-routes.test.ts
  git commit -m "feat: claim route builds critic input (artifact to judge + source paper + placeholder criteria)"
  ```

---

## Task 9: worker `runStageCriticJob` stub + dispatch + tests

Add a thin/stub critic executor to the worker that mirrors `runAnalysisJob`: it seeds a workspace temp dir, runs `runCodexAgentic` with heartbeat + abort, prompts the critic to return a `CriticVerdict` JSON judging `artifactToJudge` against `criteria`, validates with `parseCriticVerdict`, and POSTs to `/complete`. In Phase 1 the criteria are a generic placeholder so the critic will usually PASS.

**Files**
- Modify: `scripts/researchfinder-worker.ts`
- Modify: `tests/researchfinder-worker.test.ts`

- [ ] **Step 1 — Failing test.** Add to `tests/researchfinder-worker.test.ts`:
```ts
  it("completes a claimed research critic job with an agentic stub run and validated verdict", async () => {
    const verdictOutput = {
      researchProjectId: "proj-1",
      stageType: "plan",
      verdict: "PASS",
      scorecard: [{ criterion: "Phase-1 stub", pass: true, note: "Looks adequate for the spine." }]
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_plan_critic",
            id: "plan-critic-1",
            input: {
              researchProjectId: "proj-1",
              stageType: "plan",
              artifactToJudge: { researchProjectId: "proj-1", hypotheses: ["H1"] },
              sourcePaper: {
                id: "p1", arxivId: "2401.00001", title: "Source Paper", abstract: "A.",
                url: "https://arxiv.org/abs/2401.00001", authors: [], categories: [],
                publishedAt: "2024-01-01T00:00:00.000Z"
              },
              criteria: "plan criteria placeholder — Phase 2 fills this in"
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodexAgentic = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(verdictOutput);
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      { appUrl: "https://research.example.com", workerToken: "worker-token", codexCommand: "codex-test" },
      { runCodexAgentic, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(runCodexAgentic).toHaveBeenCalledTimes(1);
    expect(promptText).toContain("CriticVerdict");
    expect(promptText).toContain("PASS|REDO|BACKTRACK");
    const completionRequest = fetchMock.mock.calls[1];
    expect(completionRequest?.[0]).toBe(
      "https://research.example.com/api/workers/jobs/plan-critic-1/complete"
    );
    const completionBody = JSON.parse(String(completionRequest?.[1]?.body));
    expect(completionBody.type).toBe("research_plan_critic");
    expect(completionBody.output).toEqual(verdictOutput);
  });
```
(`readFile` is already imported at the top of this test file.)

- [ ] **Step 2 — Run it; expect FAIL** (claimed critic job hits the final `FatalWorkerError("No local executor is registered...")` because no dispatch arm exists):
  ```bash
  npx vitest run tests/researchfinder-worker.test.ts
  ```

- [ ] **Step 3 — Add the executor + dispatch to `scripts/researchfinder-worker.ts`.** Extend the worker output-validation import (lines 28–33) to include `parseCriticVerdict`:
```ts
import {
  parseCriticVerdict,
  parseInboxGenerationOutput,
  parseNoveltyScanOutput,
  parseResearchStageOutput,
  parseViabilityOutput
} from "@/worker/output-validation";
```
Add the dispatch arms in `runResearchFinderWorkerOnce` after the `research_analysis` arm (after line 257, before the final `throw new FatalWorkerError`):
```ts
  if (
    payload.job.type === "research_plan_critic" ||
    payload.job.type === "research_literature_critic" ||
    payload.job.type === "research_experiment_critic" ||
    payload.job.type === "research_analysis_critic"
  ) {
    const result = await runStageCriticJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }
```
Add the executor near `runAnalysisJob` (it reuses the same workspace/heartbeat/abort pattern). A critic input has no Zod input schema in Phase 1, so parse it defensively:
```ts
type StageCriticJobInput = {
  researchProjectId: string;
  stageType: string;
  artifactToJudge: unknown;
  sourcePaper: unknown;
  criteria: string;
};

function parseStageCriticJobInput(value: unknown): StageCriticJobInput {
  if (!isRecord(value)) {
    throw new FatalWorkerError("Stage critic job input must be an object");
  }
  return {
    researchProjectId: readString(value.researchProjectId, "researchProjectId"),
    stageType: readString(value.stageType, "stageType"),
    artifactToJudge: value.artifactToJudge,
    sourcePaper: value.sourcePaper,
    criteria: readString(value.criteria, "criteria")
  };
}

function stageCriticWorkspaceDir(researchProjectId: string, stageType: string) {
  const root =
    process.env.RESEARCHFINDER_EXPERIMENT_WORKSPACE_ROOT ??
    join(process.cwd(), ".research-workspaces");
  return join(root, researchProjectId, `${stageType}-critic`);
}

function buildStageCriticPrompt(input: StageCriticJobInput) {
  return [
    "You are an adversarial research critic. Judge the ARTIFACT.json in your current working",
    "directory against the stated criteria and return a single CriticVerdict JSON as your final message.",
    "Do not wrap it in Markdown. Default to rejection when genuinely unsure (anti-rubber-stamp).",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    `The JSON stageType must be exactly ${JSON.stringify(input.stageType)}.`,
    "Required keys: researchProjectId, stageType, verdict (one of PASS|REDO|BACKTRACK),",
    "scorecard (>=1, each {criterion, pass: boolean, note}).",
    "If verdict is REDO or BACKTRACK, include feedback. If verdict is BACKTRACK, also include",
    "targetStage (one of plan|literature|experiment|analysis|paper).",
    "Criteria for this stage:",
    input.criteria,
    "",
    "The artifact to judge and the source paper are in ARTIFACT.json and SOURCE.json in this directory."
  ].join("\n");
}

async function runStageCriticJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseStageCriticJobInput(job.input);
  const workspaceDir = stageCriticWorkspaceDir(input.researchProjectId, input.stageType);
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(join(workspaceDir, "ARTIFACT.json"), JSON.stringify(input.artifactToJudge, null, 2), "utf8");
  await writeFile(join(workspaceDir, "SOURCE.json"), JSON.stringify(input.sourcePaper, null, 2), "utf8");

  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-critic-"));
  const promptFile = join(promptDir, `${job.id}.prompt.md`);
  await writeFile(promptFile, buildStageCriticPrompt(input), "utf8");

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
      const message = controller.signal.aborted ? "Critic aborted by user" : formatErrorMessage(error);
      await failWorkerJob(config, job, new Error(message));
      throw new ProcessedWorkerError(error);
    }

    try {
      return { output: parseCriticVerdict(rawOutput) };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    clearInterval(heartbeat);
    await rm(promptDir, { force: true, recursive: true });
  }
}
```

- [ ] **Step 4 — Run the worker test; expect PASS:**
  ```bash
  npx vitest run tests/researchfinder-worker.test.ts
  ```
  Expected: the new critic test plus all existing worker tests pass.

- [ ] **Step 5 — Type-check; expect PASS:**
  ```bash
  npx tsc --noEmit
  ```

- [ ] **Step 6 — Commit:**
  ```bash
  git add scripts/researchfinder-worker.ts tests/researchfinder-worker.test.ts
  git commit -m "feat: worker runStageCriticJob stub (agentic verdict run + heartbeat + abort) + dispatch"
  ```

---

## Final verification (run after Task 9)

- [ ] **Branch-relevant unit suites (no DB):**
  ```bash
  npx vitest run tests/research-router.test.ts tests/critic-verdict-schema.test.ts tests/research-stage-helpers.test.ts tests/research-stages.test.ts tests/worker-lanes.test.ts tests/researchfinder-worker.test.ts
  ```
- [ ] **Postgres-backed suites:**
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-orchestration-schema.test.ts tests/research-lifecycle.test.ts tests/research-worker-routes.test.ts tests/research-complete-route-critic.test.ts --testTimeout=120000 --hookTimeout=120000
  ```
- [ ] **Whole-repo type-check:** `npx tsc --noEmit`
- [ ] Confirm no leftover references to the old forward-only advance in `completeResearchStageJob` and that the detail page still renders (it reads `stageArtifacts`/`stageJobs` by stage; with supersession there can now be multiple artifacts per stage — out of scope to fix the page this phase, but verify it does not crash with a superseded duplicate; if its `Map(...)` collision is a concern, note it for Phase 5 rather than changing the page here).

---

## Phase-1 requirement → task traceability

| Spec / scope requirement | Task |
|---|---|
| `ResearchStageJob` adds `attempt`, `feedback`, `verdictJson`, `kind` | 1 |
| `ResearchStageArtifact` adds `supersededAt` (+ drop unique) | 1 |
| `ResearchProject` adds `producerRunsUsed`, `backtracksUsed` | 1 |
| Data-preserving migration after latest timestamp | 1 |
| `needs_review` app-level status (status is a String column) | 2 |
| `stagesAfter` helper | 2 |
| `CriticVerdictSchema` + superRefine + type + `parseCriticVerdict` | 3 |
| `research_*_critic` in lanes (`WORKER_JOB_TYPES`/`WorkerJobType`/`LANE_JOB_TYPES`) | 4 |
| Duplicated union in `complete/route.ts` | 5 |
| Duplicated whitelist in worker `parseClaimPayload` | 5 |
| Pure `routeAfterCritic` + caps, unit-tested without DB | 6 |
| State machine wired into `completeResearchStageJob` (producer→critic; PASS/REDO/BACKTRACK; caps→`needs_review`; abort-gating) | 7 |
| Claim route critic input builder | 8 |
| Worker `runStageCriticJob` stub + dispatch | 9 |
