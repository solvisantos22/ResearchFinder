# Research Stage Registry + Literature Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the merged plan-stage research code into a stage-registry-driven harness, and add the `literature` stage (server-side scholarly retrieval → Codex synthesizes a grounded literature review).

**Architecture:** Replace the plan-specific `ResearchPlanJob`/`ResearchPlan` tables with generic `ResearchStageJob`/`ResearchStageArtifact` (a `stageType` discriminator), driven by a stage registry (`src/lib/research/stages.ts`) that lists stage order, which stages have executors, and each stage's output schema + grounding requirement. The harness advance becomes generic: on stage completion, persist the artifact, then enqueue the next executable stage (or set a `${stage}_ready` terminal). The literature stage reuses the novelty retrieval adapters in the worker executor.

**Tech Stack:** Next.js 15 App Router (route handlers, server actions), Prisma/Postgres, Zod, Vitest + Testing Library, tsx worker script.

**Conventions:** Postgres-backed tests use `withPostgresTestDatabase` (`tests/helpers/postgres.ts`) with the `vi.mock("@/lib/db", () => ({ get prisma() {...} }))` + `mocked.prisma = db` pattern (see `tests/research-lifecycle.test.ts`). Run them with `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'` and `--no-file-parallelism --testTimeout 60000`. Migration SQL files must have NO BOM (see the `55ee5b8` fix). End commits with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

**Source-paper grounding invariant:** every citation-emitting stage must include the source paper as a `sourceType: "paper"` citation with matching `sourceId`/`url`, enforced by the existing `assertCitesSourcePaper` in `src/lib/jobs/research.ts`.

---

## File structure

**New files:**
- `src/lib/research/stages.ts` — stage order, `EXECUTABLE_STAGES`, `nextExecutableStage`, and the `STAGE_REGISTRY` (per-stage output schema + grounding flag).
- `tests/research-stages.test.ts` — registry + `nextExecutableStage` unit tests.
- `prisma/migrations/20260626210000_research_stage_registry/migration.sql` — generic tables + data-preserving migration.
- `tests/research-stage-schema.test.ts` — generic model persistence + uniqueness.

**Modified files:**
- `src/lib/v2/schemas.ts` — add `LiteratureReviewSchema`, `LiteratureJobInputSchema`, types.
- `prisma/schema.prisma` — replace `ResearchPlanJob`/`ResearchPlan` with `ResearchStageJob`/`ResearchStageArtifact`; update `ResearchProject` relations.
- `src/lib/jobs/research.ts` — generic lifecycle (`developIdea` retargeted, `claimNextResearchStageJob`, `completeResearchStageJob` + `advanceAfterStage`, `failResearchStageJob`, `getResearchProjectDetail`); delete the plan-specific functions.
- `src/lib/workers/lanes.ts` — add `research_literature` to job types + lanes.
- `src/app/api/workers/claim/route.ts` — generic research-stage claim + per-stage input builders (plan kept; literature added).
- `src/app/api/workers/jobs/[jobId]/complete/route.ts` — generic research-stage completion + failure routing.
- `src/worker/output-validation.ts` — `parseResearchStageOutput(stageType, raw)`.
- `scripts/researchfinder-worker.ts` — generic research-stage executor dispatch + literature executor (retrieval → prompt → Codex).
- `src/app/research/[projectId]/page.tsx` — generic stage timeline + plan & literature renderers.
- Test files updated alongside: `tests/research-schemas.test.ts`, `tests/research-lifecycle.test.ts`, `tests/research-worker-routes.test.ts`, `tests/research-worker-output.test.ts`, `tests/researchfinder-worker.test.ts`, `tests/research-pages.test.tsx`.

---

## Task 1: Literature schemas

**Files:**
- Modify: `src/lib/v2/schemas.ts` (after `ResearchPlanJobInputSchema`, around line 325)
- Test: `tests/research-schemas.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/research-schemas.test.ts`:

```ts
import { LiteratureReviewSchema } from "@/lib/v2/schemas";

describe("LiteratureReviewSchema", () => {
  const valid = {
    researchProjectId: "proj-1",
    relationToSourcePaper: "Extends the source paper's method to a new domain.",
    relatedWorks: [
      { title: "Related A", summary: "Does X.", relationToProposed: "We differ by Y." }
    ],
    themes: ["benchmarking"],
    gaps: ["no open benchmark for Z"],
    positioning: "We close the Z gap the surveyed work leaves open.",
    citations: [
      {
        sourceType: "paper",
        title: "Source paper",
        url: "https://arxiv.org/abs/2501.00001",
        sourceId: "2501.00001",
        claim: "Foundational method.",
        confidence: 0.9
      }
    ]
  };

  it("accepts a well-formed literature review", () => {
    expect(LiteratureReviewSchema.parse(valid)).toMatchObject({ researchProjectId: "proj-1" });
  });

  it("rejects a missing relationToSourcePaper", () => {
    const { relationToSourcePaper: _omit, ...rest } = valid;
    expect(LiteratureReviewSchema.safeParse(rest).success).toBe(false);
  });

  it("requires at least one related work, theme, gap, and citation", () => {
    expect(LiteratureReviewSchema.safeParse({ ...valid, relatedWorks: [] }).success).toBe(false);
    expect(LiteratureReviewSchema.safeParse({ ...valid, themes: [] }).success).toBe(false);
    expect(LiteratureReviewSchema.safeParse({ ...valid, gaps: [] }).success).toBe(false);
    expect(LiteratureReviewSchema.safeParse({ ...valid, citations: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run tests/research-schemas.test.ts` → FAIL (`LiteratureReviewSchema` is not exported).

- [ ] **Step 3: Implement.** In `src/lib/v2/schemas.ts`, immediately after the `ResearchPlanJobInputSchema` block (line ~325) add:

```ts
export const LiteratureReviewSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: NonEmptyTrimmedStringSchema,
  relatedWorks: z
    .array(
      strictObject({
        title: NonEmptyTrimmedStringSchema,
        summary: NonEmptyTrimmedStringSchema,
        relationToProposed: NonEmptyTrimmedStringSchema
      })
    )
    .min(1),
  themes: z.array(NonEmptyTrimmedStringSchema).min(1),
  gaps: z.array(NonEmptyTrimmedStringSchema).min(1),
  positioning: NonEmptyTrimmedStringSchema,
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
  citations: z.array(CitationSchema)
});
```

And add the type exports next to the existing research type exports (line ~328):

```ts
export type LiteratureReview = z.infer<typeof LiteratureReviewSchema>;
export type LiteratureJobInput = z.infer<typeof LiteratureJobInputSchema>;
```

- [ ] **Step 4: Run the test to verify it passes** — `npx vitest run tests/research-schemas.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/schemas.ts tests/research-schemas.test.ts
git commit -m "feat: add literature review + literature job input schemas"
```

---

## Task 2: Stage registry

**Files:**
- Create: `src/lib/research/stages.ts`
- Test: `tests/research-stages.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/research-stages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RESEARCH_STAGES,
  EXECUTABLE_STAGES,
  nextExecutableStage,
  STAGE_REGISTRY
} from "@/lib/research/stages";
import { LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";

describe("research stage registry", () => {
  it("lists stages in pipeline order", () => {
    expect(RESEARCH_STAGES).toEqual(["plan", "literature", "experiment", "analysis", "paper"]);
  });

  it("only plan and literature have executors today", () => {
    expect(EXECUTABLE_STAGES).toEqual(["plan", "literature"]);
  });

  it("advances plan -> literature, and literature is terminal-for-now", () => {
    expect(nextExecutableStage("plan")).toBe("literature");
    expect(nextExecutableStage("literature")).toBeNull();
  });

  it("maps each executable stage to its output schema and grounding requirement", () => {
    expect(STAGE_REGISTRY.plan.outputSchema).toBe(ResearchPlanSchema);
    expect(STAGE_REGISTRY.literature.outputSchema).toBe(LiteratureReviewSchema);
    expect(STAGE_REGISTRY.plan.requiresSourcePaperCitation).toBe(true);
    expect(STAGE_REGISTRY.literature.requiresSourcePaperCitation).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run tests/research-stages.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/research/stages.ts`:

```ts
import { LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";
import type { ZodTypeAny } from "zod";

export const RESEARCH_STAGES = ["plan", "literature", "experiment", "analysis", "paper"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

// Stages with a worker executor today. Experiment/analysis/paper are added here (plus a
// STAGE_REGISTRY entry) as they are built; the harness then advances into them automatically.
export const EXECUTABLE_STAGES: ResearchStage[] = ["plan", "literature"];

type StageDefinition = {
  outputSchema: ZodTypeAny;
  requiresSourcePaperCitation: boolean;
};

export const STAGE_REGISTRY: Record<"plan" | "literature", StageDefinition> = {
  plan: { outputSchema: ResearchPlanSchema, requiresSourcePaperCitation: true },
  literature: { outputSchema: LiteratureReviewSchema, requiresSourcePaperCitation: true }
};

// The next stage in pipeline order that currently has an executor, or null (terminal-for-now).
export function nextExecutableStage(after: ResearchStage): ResearchStage | null {
  const startIndex = RESEARCH_STAGES.indexOf(after);
  for (let i = startIndex + 1; i < RESEARCH_STAGES.length; i++) {
    const stage = RESEARCH_STAGES[i];
    if (EXECUTABLE_STAGES.includes(stage)) return stage;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes** — `npx vitest run tests/research-stages.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/stages.ts tests/research-stages.test.ts
git commit -m "feat: add research stage registry and ordering helper"
```

---

## Task 3: Generic Prisma models + data-preserving migration

**Files:**
- Modify: `prisma/schema.prisma:439-485` (the `ResearchProject`/`ResearchPlanJob`/`ResearchPlan` block)
- Create: `prisma/migrations/20260626210000_research_stage_registry/migration.sql`
- Test: `tests/research-stage-schema.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/research-stage-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";

describe("research stage schema", () => {
  it("persists a stage job and artifact, one per (project, stageType)", async () => {
    await withPostgresTestDatabase(async (db) => {
      const user = await db.user.create({ data: { email: "stage@example.com" } });
      const paper = await db.paper.create({
        data: {
          arxivId: "2501.10000", title: "P", abstract: "A", url: "https://arxiv.org/abs/2501.10000",
          publishedAt: new Date(), arxivUpdatedAt: new Date(), authorsJson: "[]", categoriesJson: "[]"
        }
      });
      const idea = await db.generatedIdea.create({
        data: {
          userId: user.id, paperId: paper.id, inboxDate: "2026-06-26", title: "I", summary: "S",
          expandedExplanation: "E", trajectory: "T", recommended: true, noveltyStatus: "not_checked",
          relevanceScore: 0.5, significanceScore: 0.5, originalityScore: 0.5, feasibilityScore: 0.5,
          overallScore: 0.5, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "X", generatedBy: "codex"
        }
      });
      const project = await db.researchProject.create({
        data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
      });

      const job = await db.researchStageJob.create({
        data: {
          researchProjectId: project.id, userId: user.id, stageType: "plan",
          status: "queued", inputJson: "{}"
        }
      });
      expect(job.stageType).toBe("plan");

      await db.researchStageArtifact.create({
        data: { researchProjectId: project.id, stageType: "plan", artifactJson: "{}" }
      });

      await expect(
        db.researchStageJob.create({
          data: {
            researchProjectId: project.id, userId: user.id, stageType: "plan",
            status: "queued", inputJson: "{}"
          }
        })
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run tests/research-stage-schema.test.ts --no-file-parallelism --testTimeout 60000` → FAIL (`researchStageJob` undefined on the client).

- [ ] **Step 3: Replace the models in `prisma/schema.prisma`.** Change `ResearchProject`'s relations and replace `ResearchPlanJob` + `ResearchPlan`:

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

  user           User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  generatedIdea  GeneratedIdea          @relation(fields: [generatedIdeaId], references: [id], onDelete: Cascade)
  stageJobs      ResearchStageJob[]
  stageArtifacts ResearchStageArtifact[]

  @@index([userId, status, createdAt, id])
}

model ResearchStageJob {
  id                String    @id @default(cuid())
  researchProjectId String
  userId            String
  stageType         String
  status            String
  claimedByWorkerId String?
  inputJson         String
  outputJson        String?
  errorMessage      String?
  createdAt         DateTime  @default(now())
  startedAt         DateTime?
  completedAt       DateTime?
  updatedAt         DateTime  @updatedAt

  researchProject ResearchProject @relation(fields: [researchProjectId], references: [id], onDelete: Cascade)
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([researchProjectId, stageType])
  @@index([userId, status, createdAt, id])
  @@index([claimedByWorkerId, status])
}

model ResearchStageArtifact {
  id                String   @id @default(cuid())
  researchProjectId String
  stageType         String
  artifactJson      String
  createdAt         DateTime @default(now())

  researchProject ResearchProject @relation(fields: [researchProjectId], references: [id], onDelete: Cascade)

  @@unique([researchProjectId, stageType])
}
```

Also update the `User` model's back-relations: find the lines `researchPlanJobs ResearchPlanJob[]` (or equivalent — search the `User` model for `ResearchPlanJob`) and replace any `ResearchPlanJob`/`ResearchPlan` back-relation with `researchStageJobs ResearchStageJob[]`. (If the `User` model only relates to `ResearchPlanJob`, replace that one line; artifacts have no `user` relation.)

- [ ] **Step 4: Create the migration SQL** `prisma/migrations/20260626210000_research_stage_registry/migration.sql` (NO BOM):

```sql
-- Generic research stage tables
CREATE TABLE "ResearchStageJob" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "claimedByWorkerId" TEXT,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchStageJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchStageJob_researchProjectId_stageType_key" ON "ResearchStageJob"("researchProjectId", "stageType");
CREATE INDEX "ResearchStageJob_userId_status_createdAt_id_idx" ON "ResearchStageJob"("userId", "status", "createdAt", "id");
CREATE INDEX "ResearchStageJob_claimedByWorkerId_status_idx" ON "ResearchStageJob"("claimedByWorkerId", "status");
ALTER TABLE "ResearchStageJob" ADD CONSTRAINT "ResearchStageJob_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchStageJob" ADD CONSTRAINT "ResearchStageJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ResearchStageArtifact" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "artifactJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchStageArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchStageArtifact_researchProjectId_stageType_key" ON "ResearchStageArtifact"("researchProjectId", "stageType");
ALTER TABLE "ResearchStageArtifact" ADD CONSTRAINT "ResearchStageArtifact_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing plan-stage rows forward as stageType = 'plan'
INSERT INTO "ResearchStageJob" ("id", "researchProjectId", "userId", "stageType", "status", "claimedByWorkerId", "inputJson", "outputJson", "errorMessage", "createdAt", "startedAt", "completedAt", "updatedAt")
SELECT "id", "researchProjectId", "userId", 'plan', "status", "claimedByWorkerId", "inputJson", "outputJson", "errorMessage", "createdAt", "startedAt", "completedAt", "updatedAt"
FROM "ResearchPlanJob";

INSERT INTO "ResearchStageArtifact" ("id", "researchProjectId", "stageType", "artifactJson", "createdAt")
SELECT "id", "researchProjectId", 'plan', "planJson", "createdAt"
FROM "ResearchPlan";

-- Drop the plan-specific tables
DROP TABLE "ResearchPlan";
DROP TABLE "ResearchPlanJob";
```

- [ ] **Step 5: Regenerate the client** — `npx prisma generate`.

- [ ] **Step 6: Run the test to verify it passes** — same command as Step 2 → PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260626210000_research_stage_registry tests/research-stage-schema.test.ts
git commit -m "feat: generic research stage job + artifact model with data-preserving migration"
```

---

## Task 4: Generic lifecycle — develop, claim, reads

**Files:**
- Modify: `src/lib/jobs/research.ts`
- Test: `tests/research-lifecycle.test.ts`

This task retargets `developIdea` and the read/claim functions to the generic model. Task 5 handles completion/advance. After this task `research.ts` will still reference `completeResearchStageJob` (added in Task 5) — so do Tasks 4 and 5 back-to-back; the suite is green only after Task 5.

- [ ] **Step 1: Write the failing test** — replace the develop/claim tests in `tests/research-lifecycle.test.ts` (keep the `seedIdea` helper). Add:

```ts
import { developIdea, claimNextResearchStageJob } from "@/lib/jobs/research";

describe("developIdea (generic stage model)", () => {
  it("creates a project and a queued plan stage job", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea } = await seedIdea(db);
      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });

      const jobs = await db.researchStageJob.findMany({ where: { researchProjectId: project.id } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ stageType: "plan", status: "queued" });
      expect(project.currentStage).toBe("plan");
    });
  });

  it("is idempotent for a non-aborted project", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea } = await seedIdea(db);
      const a = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const b = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      expect(b.id).toBe(a.id);
    });
  });
});

describe("claimNextResearchStageJob", () => {
  it("claims the queued plan job with the idea + paper loaded", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });

      const claimed = await claimNextResearchStageJob({ userId: user.id, workerId: "w1" });
      expect(claimed?.stageType).toBe("plan");
      expect(claimed?.researchProject.generatedIdea.paper.arxivId).toBe("2501.00001");
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `TEST_DATABASE_URL='...:5432...' npx vitest run tests/research-lifecycle.test.ts --no-file-parallelism --testTimeout 60000` → FAIL.

- [ ] **Step 3: Implement.** In `src/lib/jobs/research.ts`, replace `developIdea`'s job creation and the claim/reads. Replace the `tx.researchPlanJob.create(...)` call inside `developIdea` with:

```ts
    await tx.researchStageJob.create({
      data: {
        researchProjectId: project.id,
        userId: input.currentUserId,
        stageType: "plan",
        status: "queued",
        inputJson: JSON.stringify({ researchProjectId: project.id })
      }
    });
```

Replace `claimNextResearchPlanJob` with `claimNextResearchStageJob` (same claim loop, generic table, claims any executable stage):

```ts
import { EXECUTABLE_STAGES } from "@/lib/research/stages";

export async function claimNextResearchStageJob(input: { userId: string; workerId: string }) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const staleStartedBefore = staleRunningJobStartedBefore();
    const job = await prisma.researchStageJob.findFirst({
      where: {
        userId: input.userId,
        stageType: { in: EXECUTABLE_STAGES },
        researchProject: { status: { not: "aborted" } },
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleStartedBefore } }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (!job) return null;

    const claim = await prisma.researchStageJob.updateMany({
      where: {
        id: job.id,
        userId: input.userId,
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleStartedBefore } }
        ]
      },
      data: {
        status: "running",
        claimedByWorkerId: input.workerId,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null
      }
    });

    if (claim.count !== 1) continue;

    return prisma.researchStageJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        researchProject: {
          include: {
            generatedIdea: { include: { paper: true, citations: true } },
            stageArtifacts: true
          }
        }
      }
    });
  }

  return null;
}
```

Update `getResearchProjectDetail` to include the generic relations:

```ts
export async function getResearchProjectDetail(input: { currentUserId: string; projectId: string }) {
  const project = await prisma.researchProject.findUnique({
    where: { id: input.projectId },
    include: {
      generatedIdea: { include: { paper: true } },
      stageJobs: { orderBy: { createdAt: "asc" } },
      stageArtifacts: true
    }
  });

  if (!project || project.userId !== input.currentUserId) return null;
  return project;
}
```

(Leave `listResearchProjectsForUser`, `abortResearchProject`, `assertCitesSourcePaper`, and `buildViabilityContextFromArtifactContent` unchanged. The old `claimNextResearchPlanJob` is now removed.)

- [ ] **Step 4: Run the test to verify it passes (develop + claim only).** It will still fail to import `completeResearchStageJob` if other tests in the file reference it — run only the new describes for now: `... npx vitest run tests/research-lifecycle.test.ts -t "developIdea (generic stage model)" --no-file-parallelism --testTimeout 60000`. Expected: PASS for develop + claim describes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/research.ts tests/research-lifecycle.test.ts
git commit -m "feat: retarget developIdea + claim to the generic research stage model"
```

---

## Task 5: Generic completion + harness advance

**Files:**
- Modify: `src/lib/jobs/research.ts`
- Test: `tests/research-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test** — add to `tests/research-lifecycle.test.ts`. Reuse the existing `planOutput` helper; add a `literatureOutput` helper:

```ts
import { completeResearchStageJob, failResearchStageJob } from "@/lib/jobs/research";

function literatureOutput(researchProjectId: string, paper: { arxivId: string; url: string }) {
  return {
    researchProjectId,
    relationToSourcePaper: "Extends the source paper.",
    relatedWorks: [{ title: "RW", summary: "does x", relationToProposed: "we differ" }],
    themes: ["theme"],
    gaps: ["gap"],
    positioning: "we close the gap",
    citations: [
      { sourceType: "paper", title: "Source paper", url: paper.url, sourceId: paper.arxivId, claim: "c", confidence: 0.9 }
    ]
  };
}

async function claimPlanAndComplete(db, user, idea) {
  await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
  const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
  await completeResearchStageJob({
    jobId: plan!.id, workerId: "w",
    output: planOutput(plan!.researchProjectId, { arxivId: idea.paperArxivId, url: idea.paperUrl })
  });
  return plan!.researchProjectId;
}

describe("completeResearchStageJob advance", () => {
  it("plan completion enqueues a literature job and sets the project running", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      await completeResearchStageJob({
        jobId: plan!.id, workerId: "w",
        output: planOutput(plan!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });

      const project = await db.researchProject.findUniqueOrThrow({ where: { id: plan!.researchProjectId } });
      expect(project).toMatchObject({ currentStage: "literature", status: "running" });
      const litJob = await db.researchStageJob.findFirst({
        where: { researchProjectId: project.id, stageType: "literature" }
      });
      expect(litJob?.status).toBe("queued");
      const planArtifact = await db.researchStageArtifact.findFirst({
        where: { researchProjectId: project.id, stageType: "plan" }
      });
      expect(planArtifact).not.toBeNull();
    });
  });

  it("literature completion sets literature_ready (no further executor)", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      await completeResearchStageJob({
        jobId: plan!.id, workerId: "w",
        output: planOutput(plan!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });
      const lit = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      expect(lit?.stageType).toBe("literature");
      await completeResearchStageJob({
        jobId: lit!.id, workerId: "w",
        output: literatureOutput(lit!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });

      const project = await db.researchProject.findUniqueOrThrow({ where: { id: lit!.researchProjectId } });
      expect(project.status).toBe("literature_ready");
    });
  });

  it("rejects a stage output that omits the source-paper citation", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      const bad = planOutput(plan!.researchProjectId, { arxivId: paper.arxivId, url: paper.url });
      bad.citations = bad.citations.map((c) => ({ ...c, sourceType: "generated_analysis", url: "" }));
      await expect(
        completeResearchStageJob({ jobId: plan!.id, workerId: "w", output: bad })
      ).rejects.toThrow();
      const artifact = await db.researchStageArtifact.findFirst({ where: { researchProjectId: plan!.researchProjectId } });
      expect(artifact).toBeNull();
    });
  });

  it("abort blocks advancement", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      await db.researchProject.update({ where: { id: plan!.researchProjectId }, data: { status: "aborted" } });
      await completeResearchStageJob({
        jobId: plan!.id, workerId: "w",
        output: planOutput(plan!.researchProjectId, { arxivId: paper.arxivId, url: paper.url })
      });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: plan!.researchProjectId } });
      expect(project.status).toBe("aborted");
      const litJob = await db.researchStageJob.findFirst({ where: { researchProjectId: project.id, stageType: "literature" } });
      expect(litJob).toBeNull();
    });
  });

  it("failResearchStageJob fails the job and the running project", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea } = await seedIdea(db);
      await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const plan = await claimNextResearchStageJob({ userId: user.id, workerId: "w" });
      await failResearchStageJob({ jobId: plan!.id, errorMessage: "boom" });
      const job = await db.researchStageJob.findUniqueOrThrow({ where: { id: plan!.id } });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: plan!.researchProjectId } });
      expect(job.status).toBe("failed");
      expect(project.status).toBe("failed");
    });
  });
});
```

(If the existing `seedIdea` does not return `paper`, it already does — see `tests/research-lifecycle.test.ts:55`. Remove any now-obsolete tests that referenced `completeResearchPlanJob`/`researchPlanJob`.)

- [ ] **Step 2: Run it to verify it fails** — `... npx vitest run tests/research-lifecycle.test.ts --no-file-parallelism --testTimeout 60000` → FAIL (`completeResearchStageJob`/`failResearchStageJob` not exported).

- [ ] **Step 3: Implement.** In `src/lib/jobs/research.ts`, remove `completeResearchPlanJob` and `failResearchPlanJob` and add the functions below. Import housekeeping: `ResearchPlanSchema` is no longer used in this file (the registry owns parsing) — drop it from the line-4 import, leaving `import { type Citation, ViabilityResultSchema } from "@/lib/v2/schemas";`. Merge the stages import with the one added in Task 4 into a single line: `import { EXECUTABLE_STAGES, STAGE_REGISTRY, nextExecutableStage, type ResearchStage } from "@/lib/research/stages";` (do not add a second import statement).

```ts
// (single merged stages import — shown here for reference; do not duplicate the Task 4 import)
// import { EXECUTABLE_STAGES, STAGE_REGISTRY, nextExecutableStage, type ResearchStage } from "@/lib/research/stages";

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

    const stage = job.stageType as ResearchStage;
    const definition = STAGE_REGISTRY[stage as "plan" | "literature"];
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

    // Harness advance, abort-safe: gate on the project's CURRENT status via conditional
    // updateMany so an abort committing concurrently is never resurrected.
    const next = nextExecutableStage(stage);
    const advance = await tx.researchProject.updateMany({
      where: { id: job.researchProjectId, status: { not: "aborted" } },
      data: next ? { currentStage: next, status: "running" } : { status: `${stage}_ready` }
    });

    // Project was aborted between claim and completion: job recorded completed, but no
    // artifact persisted and no next stage enqueued.
    if (advance.count !== 1) {
      return;
    }

    await tx.researchStageArtifact.create({
      data: { researchProjectId: job.researchProjectId, stageType: stage, artifactJson: JSON.stringify(parsed) }
    });

    if (next) {
      await tx.researchStageJob.create({
        data: {
          researchProjectId: job.researchProjectId,
          userId: job.userId,
          stageType: next,
          status: "queued",
          inputJson: JSON.stringify({ researchProjectId: job.researchProjectId })
        }
      });
    }
  });
}

export async function failResearchStageJob(input: { jobId: string; errorMessage: string }) {
  await prisma.$transaction(async (tx) => {
    const job = await tx.researchStageJob.findUnique({
      where: { id: input.jobId },
      select: { researchProjectId: true }
    });

    if (!job) return;

    await tx.researchStageJob.updateMany({
      where: { id: input.jobId, status: { in: ["queued", "running"] } },
      data: { status: "failed", errorMessage: input.errorMessage, completedAt: new Date() }
    });

    await tx.researchProject.updateMany({
      where: { id: job.researchProjectId, status: "running" },
      data: { status: "failed" }
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes** — `... npx vitest run tests/research-lifecycle.test.ts --no-file-parallelism --testTimeout 60000` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/research.ts tests/research-lifecycle.test.ts
git commit -m "feat: generic research stage completion with harness advance + failure"
```

---

## Task 6: Worker output validation (generic)

**Files:**
- Modify: `src/worker/output-validation.ts`
- Test: `tests/research-worker-output.test.ts`

- [ ] **Step 1: Write the failing test** — add to `tests/research-worker-output.test.ts`:

```ts
import { parseResearchStageOutput } from "@/worker/output-validation";

describe("parseResearchStageOutput", () => {
  it("parses a plan stage output", () => {
    const out = parseResearchStageOutput("plan", JSON.stringify({
      researchProjectId: "p1", relationToSourcePaper: "x", hypotheses: ["h"], experimentalDesign: "d",
      protocolSteps: ["s"], datasets: [], baselines: [], metrics: [], successCriteria: ["c"],
      computeEstimate: "e", risks: [],
      citations: [{ sourceType: "paper", title: "t", url: "https://a/abs/1", sourceId: "1", claim: "c", confidence: 0.9 }]
    }));
    expect(out).toMatchObject({ researchProjectId: "p1" });
  });

  it("parses a literature stage output", () => {
    const out = parseResearchStageOutput("literature", JSON.stringify({
      researchProjectId: "p1", relationToSourcePaper: "x",
      relatedWorks: [{ title: "rw", summary: "s", relationToProposed: "r" }],
      themes: ["t"], gaps: ["g"], positioning: "pos",
      citations: [{ sourceType: "paper", title: "t", url: "https://a/abs/1", sourceId: "1", claim: "c", confidence: 0.9 }]
    }));
    expect(out).toMatchObject({ researchProjectId: "p1" });
  });

  it("throws for an unknown stage", () => {
    expect(() => parseResearchStageOutput("experiment", "{}")).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run tests/research-worker-output.test.ts` → FAIL.

- [ ] **Step 3: Implement.** Replace `parseResearchPlanOutput` in `src/worker/output-validation.ts` with a generic stage parser:

```ts
import { clampGeneratedInboxIdeas } from "@/lib/v2/clamp-inbox";
import {
  GeneratedInboxSchema,
  LiteratureReviewSchema,
  NoveltyScanResultSchema,
  ResearchPlanSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";

export function parseInboxGenerationOutput(raw: string) {
  return GeneratedInboxSchema.parse(clampGeneratedInboxIdeas(JSON.parse(raw)));
}

export function parseNoveltyScanOutput(raw: string) {
  return NoveltyScanResultSchema.parse(JSON.parse(raw));
}

export function parseViabilityOutput(raw: string) {
  return ViabilityResultSchema.parse(JSON.parse(raw));
}

const RESEARCH_STAGE_SCHEMAS = {
  plan: ResearchPlanSchema,
  literature: LiteratureReviewSchema
} as const;

export function parseResearchStageOutput(stageType: string, raw: string) {
  const schema = RESEARCH_STAGE_SCHEMAS[stageType as keyof typeof RESEARCH_STAGE_SCHEMAS];
  if (!schema) {
    throw new Error(`No worker output schema for research stage "${stageType}"`);
  }
  return schema.parse(JSON.parse(raw));
}
```

- [ ] **Step 4: Run the test to verify it passes** — `npx vitest run tests/research-worker-output.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/output-validation.ts tests/research-worker-output.test.ts
git commit -m "feat: generic worker research stage output validation"
```

---

## Task 7: Worker job-type lanes + claim route generalization

**Files:**
- Modify: `src/lib/workers/lanes.ts`
- Modify: `src/app/api/workers/claim/route.ts`
- Test: `tests/worker-lanes.test.ts`, `tests/research-worker-routes.test.ts`

- [ ] **Step 1: Write the failing test** — add to `tests/worker-lanes.test.ts`:

```ts
import { laneClaimsJobType, WORKER_JOB_TYPES } from "@/lib/workers/lanes";

describe("research_literature lane mapping", () => {
  it("is a known worker job type", () => {
    expect(WORKER_JOB_TYPES).toContain("research_literature");
  });
  it("is claimed by the research and both lanes, not inbox", () => {
    expect(laneClaimsJobType("research", "research_literature")).toBe(true);
    expect(laneClaimsJobType("both", "research_literature")).toBe(true);
    expect(laneClaimsJobType("inbox", "research_literature")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run tests/worker-lanes.test.ts` → FAIL.

- [ ] **Step 3: Implement lanes.** In `src/lib/workers/lanes.ts` add `research_literature`:

```ts
export const WORKER_JOB_TYPES = [
  "inbox_generation",
  "novelty_scan",
  "viability_check",
  "research_plan",
  "research_literature"
] as const;
export type WorkerJobType = (typeof WORKER_JOB_TYPES)[number];

export const LANE_JOB_TYPES: Record<WorkerLane, readonly WorkerJobType[]> = {
  inbox: ["inbox_generation", "novelty_scan"],
  research: ["viability_check", "research_plan", "research_literature"],
  both: ["inbox_generation", "novelty_scan", "viability_check", "research_plan", "research_literature"]
};
```

- [ ] **Step 4: Implement the claim route.** In `src/app/api/workers/claim/route.ts`, replace the `research_plan` claim block (lines 131-151) and the import (line 9) with a generic research-stage claim. Change the import:

```ts
import { claimNextResearchStageJob, failResearchStageJob, buildViabilityContextFromArtifactContent } from "@/lib/jobs/research";
import { LiteratureJobInputSchema, type LiteratureJobInput } from "@/lib/v2/schemas";
import { ResearchPlanSchema } from "@/lib/v2/schemas";
```

Replace the `research_plan` lane block with (claims any executable research stage; builds input by `stageType`; the worker job `type` is `research_${stageType}`):

```ts
  if (laneClaimsJobType(lane, "research_plan") || laneClaimsJobType(lane, "research_literature")) {
    const stageJob = await claimNextResearchStageJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (stageJob) {
      try {
        const input =
          stageJob.stageType === "literature"
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

Update the `ClaimedResearchPlanJob` type + `buildResearchPlanJobInput` to the generic claimed type, and add `buildLiteratureJobInput`. Replace the existing `ClaimedResearchPlanJob`/`buildResearchPlanJobInput` (lines 211-260) with:

```ts
type ClaimedResearchStageJob = NonNullable<Awaited<ReturnType<typeof claimNextResearchStageJob>>>;

async function buildResearchPlanJobInput(job: ClaimedResearchStageJob): Promise<ResearchPlanJobInput> {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;

  let viability: ResearchPlanJobInput["viability"] = null;
  if (job.researchProject.sourceViabilityJobId) {
    const artifact = await prisma.artifact.findFirst({
      where: { jobId: job.researchProject.sourceViabilityJobId, kind: "viability-report" },
      orderBy: { createdAt: "desc" }
    });
    if (artifact) {
      viability = buildViabilityContextFromArtifactContent(artifact.content);
    }
  }

  return ResearchPlanJobInputSchema.parse({
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
    viability,
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    }))
  });
}

async function buildLiteratureJobInput(job: ClaimedResearchStageJob): Promise<LiteratureJobInput> {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;

  const planArtifact = job.researchProject.stageArtifacts.find((a) => a.stageType === "plan");
  if (!planArtifact) {
    throw new Error("Literature stage requires a completed plan artifact");
  }
  const plan = ResearchPlanSchema.parse(JSON.parse(planArtifact.artifactJson));

  return LiteratureJobInputSchema.parse({
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
      metrics: plan.metrics
    },
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    }))
  });
}
```

(Ensure `ResearchPlanJobInputSchema`/`ResearchPlanJobInput` remain imported from `@/lib/v2/schemas` — they already are at the top of the file.)

- [ ] **Step 5: Update the route test.** In `tests/research-worker-routes.test.ts`, update any claim assertion that expected `type: "research_plan"` from a `researchPlanJob` row to seed a `researchStageJob` (stageType `plan`) and still expect `type: "research_plan"`; add a literature case: after a plan artifact exists and a queued `literature` stage job, the claim returns `type: "research_literature"` with `input.plan.hypotheses` populated. (Mirror the existing seed/claim structure in that file.)

- [ ] **Step 6: Run the tests to verify they pass** — `... npx vitest run tests/worker-lanes.test.ts tests/research-worker-routes.test.ts --no-file-parallelism --testTimeout 60000` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workers/lanes.ts src/app/api/workers/claim/route.ts tests/worker-lanes.test.ts tests/research-worker-routes.test.ts
git commit -m "feat: generic research stage claim + literature job input"
```

---

## Task 8: Completion route generalization

**Files:**
- Modify: `src/app/api/workers/jobs/[jobId]/complete/route.ts`
- Test: `tests/research-worker-routes.test.ts`

- [ ] **Step 1: Write the failing test** — add to `tests/research-worker-routes.test.ts` a completion case: POST to the complete route with `type: "research_literature"` for a running literature stage job completes it (persists the artifact, advances to `literature_ready`); and `type: "research_plan"` still completes a plan stage job (advances to literature). (Mirror the existing completion test structure in that file; assert via the generic `researchStageJob`/`researchStageArtifact`/`researchProject` tables.)

- [ ] **Step 2: Run it to verify it fails** — `... npx vitest run tests/research-worker-routes.test.ts --no-file-parallelism --testTimeout 60000` → FAIL.

- [ ] **Step 3: Implement.** In `src/app/api/workers/jobs/[jobId]/complete/route.ts`:

Change the import (line 9):

```ts
import { completeResearchStageJob, failResearchStageJob } from "@/lib/jobs/research";
```

Widen the `WorkerJobType` union (line 12):

```ts
type WorkerJobType =
  | "inbox_generation"
  | "novelty_scan"
  | "viability_check"
  | "research_plan"
  | "research_literature";
```

In the completion dispatch (lines 80-97), route both research stage types to the generic completer:

```ts
  try {
    if (jobType === "inbox_generation") {
      await completeInboxGenerationJob({ jobId, workerId: worker.id, output: body.output });
    } else if (jobType === "novelty_scan") {
      await completeNoveltyScanJob({ jobId, workerId: worker.id, output: body.output });
    } else if (jobType === "viability_check") {
      await completeV2ViabilityJob({ jobId, workerId: worker.id, output: body.output });
    } else {
      await completeResearchStageJob({ jobId, workerId: worker.id, output: body.output });
    }
  } catch (error) {
```

In `markWorkerJobFailed` (lines 132-140), route both research stage types to `failResearchStageJob`:

```ts
  if (input.jobType === "inbox_generation") {
    await prisma.inboxGenerationJob.updateMany({ where, data });
  } else if (input.jobType === "novelty_scan") {
    await prisma.inboxNoveltyScanJob.updateMany({ where, data });
  } else if (input.jobType === "research_plan" || input.jobType === "research_literature") {
    await failResearchStageJob({ jobId: input.jobId, errorMessage: input.errorMessage });
  } else {
    await prisma.viabilityJob.updateMany({ where, data });
  }
```

Replace `resolveJobType`'s research branch (lines 156-209) so the requested-type allowlist accepts both research stage types and the lookup uses the generic table, returning `research_${stageType}`:

```ts
  const requestedType =
    input.requestedType === "inbox_generation" ||
    input.requestedType === "novelty_scan" ||
    input.requestedType === "viability_check" ||
    input.requestedType === "research_plan" ||
    input.requestedType === "research_literature"
      ? input.requestedType
      : null;
```

(Keep the inbox/novelty/viability lookups unchanged.) Replace the final `researchPlanJob` lookup (lines 203-209) with:

```ts
  const stageJob = await prisma.researchStageJob.findFirst({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    select: { stageType: true }
  });

  if (!stageJob) return null;
  const stageJobType = `research_${stageJob.stageType}` as WorkerJobType;
  return requestedType && requestedType !== stageJobType ? null : stageJobType;
```

- [ ] **Step 4: Run the test to verify it passes** — `... npx vitest run tests/research-worker-routes.test.ts --no-file-parallelism --testTimeout 60000` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/workers/jobs/[jobId]/complete/route.ts" tests/research-worker-routes.test.ts
git commit -m "feat: generic research stage completion routing"
```

---

## Task 9: Worker literature executor

**Files:**
- Modify: `scripts/researchfinder-worker.ts`
- Test: `tests/researchfinder-worker.test.ts`

- [ ] **Step 1: Write the failing test** — add to `tests/researchfinder-worker.test.ts` a case that drives one iteration with a stubbed claim returning a `research_literature` job and asserts: `gatherNoveltySourceEvidence` is called, `runCodex` is called, and the completion POST carries the parsed literature output. Mirror the existing worker test harness (injected `runCodex`, `gatherNoveltySourceEvidence`, `fetchImpl`/global fetch stub, `maxIterations: 1`). Concretely, the claim stub returns:

```ts
{
  job: {
    type: "research_literature",
    id: "lit-1",
    input: {
      jobId: "lit-1", userId: "u1", researchProjectId: "proj-1",
      idea: { id: "i1", title: "T", summary: "S", expandedExplanation: "E", trajectory: "Tr", smallestSprint: "Sm" },
      paper: { id: "p1", arxivId: "2501.00001", title: "P", abstract: "A", url: "https://arxiv.org/abs/2501.00001", authors: [], categories: [], publishedAt: new Date().toISOString() },
      plan: { relationToSourcePaper: "x", hypotheses: ["h1"], experimentalDesign: "d", metrics: ["m"] },
      citations: []
    }
  }
}
```

with `runCodex` resolving a valid `LiteratureReviewSchema` JSON string (cite the source paper). Assert `gatherNoveltySourceEvidence` was called and the completion body's `output.researchProjectId === "proj-1"`.

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run tests/researchfinder-worker.test.ts` → FAIL (unsupported job type `research_literature`).

- [ ] **Step 3: Implement.** In `scripts/researchfinder-worker.ts`:

Update imports (lines 8-24) to add the literature schema/type, `parseResearchStageOutput`, and keep `buildNoveltyQueries`/`gatherNoveltySourceEvidence`:

```ts
import {
  InboxGenerationJobInputSchema,
  LiteratureJobInputSchema,
  NoveltyScanJobInputSchema,
  ResearchPlanJobInputSchema,
  type InboxGenerationJobInput,
  type LiteratureJobInput,
  type NoveltyScanJobInput,
  type ResearchPlanJobInput
} from "@/lib/v2/schemas";
import { buildNoveltyQueries } from "@/lib/novelty/query-builder";
import { runCodex as defaultRunCodex } from "@/worker/codex-runner";
import { gatherNoveltySourceEvidence as defaultGatherNoveltySourceEvidence } from "@/worker/novelty-sources";
import {
  parseInboxGenerationOutput,
  parseNoveltyScanOutput,
  parseResearchStageOutput,
  parseViabilityOutput
} from "@/worker/output-validation";
```

In `parseClaimPayload` (lines 339-346), accept the literature type:

```ts
  if (
    job.type !== "inbox_generation" &&
    job.type !== "novelty_scan" &&
    job.type !== "viability_check" &&
    job.type !== "research_plan" &&
    job.type !== "research_literature"
  ) {
    throw new FatalWorkerError(`Unsupported worker job type: ${String(job.type)}`);
  }
```

In `runResearchFinderWorkerOnce`, change the `research_plan` executor to use the generic stage parser and add the literature branch. Replace the `research_plan` block (lines 216-222) with:

```ts
  if (payload.job.type === "research_plan") {
    const result = await runResearchPlanJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (payload.job.type === "research_literature") {
    const result = await runLiteratureJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }
```

Change `runResearchPlanJob`'s validation call (line 472) from `parseResearchPlanOutput(rawOutput)` to `parseResearchStageOutput("plan", rawOutput)`.

Add the literature executor (after `buildResearchPlanPrompt`, line ~516):

```ts
async function runLiteratureJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseLiteratureJobInput(job.input);
  const gather = options.gatherNoveltySourceEvidence ?? defaultGatherNoveltySourceEvidence;

  const queries = buildNoveltyQueries({
    ideaTitle: input.idea.title,
    ideaSummary: input.idea.summary,
    paperTitle: input.paper.title,
    paperAbstract: input.paper.abstract,
    keywords: input.plan.hypotheses
  });
  const evidence = await gather({ queries, maxResultsPerQuery: 5 });

  const prompt = await writeLiteraturePrompt(job.id, input, { queries, ...evidence });

  try {
    let rawOutput: string;
    try {
      rawOutput = await (options.runCodex ?? defaultRunCodex)(prompt.file, {
        codexCommand: config.codexCommand
      });
    } catch (error) {
      await failWorkerJob(config, job, error);
      throw new ProcessedWorkerError(error);
    }

    try {
      return { output: parseResearchStageOutput("literature", rawOutput) };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    await rm(prompt.dir, { force: true, recursive: true });
  }
}

function parseLiteratureJobInput(value: unknown) {
  try {
    return LiteratureJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(`Literature job input failed validation: ${formatErrorMessage(error)}`);
  }
}

async function writeLiteraturePrompt(
  jobId: string,
  input: LiteratureJobInput,
  evidenceBundle: Record<string, unknown>
) {
  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-literature-"));
  const promptFile = join(promptDir, `${jobId}.prompt.md`);
  await writeFile(promptFile, buildLiteraturePrompt(input, evidenceBundle), "utf8");
  return { dir: promptDir, file: promptFile };
}

function buildLiteraturePrompt(input: LiteratureJobInput, evidenceBundle: Record<string, unknown>) {
  return [
    "You are writing a focused literature review for a viability-checked research project.",
    "Return only valid JSON matching the LiteratureReview schema exactly. Do not wrap it in Markdown.",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    "Required keys: researchProjectId, relationToSourcePaper, relatedWorks (>=1, each with",
    "title/summary/relationToProposed), themes (>=1), gaps (>=1), positioning, citations (>=1).",
    "Synthesize the gathered evidence; cite real retrieved works as sourceType \"related_work\".",
    "Ground in the source paper: relationToSourcePaper must explain how this work extends it,",
    "and citations MUST include the source paper as sourceType \"paper\" with its exact url and sourceId.",
    "If evidence is empty, still synthesize from the plan and the source paper.",
    "",
    "Claimed job input (idea, source paper, and the approved plan):",
    JSON.stringify(input, null, 2),
    "",
    "Retrieved related-work evidence:",
    JSON.stringify(evidenceBundle, null, 2)
  ].join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes** — `npx vitest run tests/researchfinder-worker.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/researchfinder-worker.ts tests/researchfinder-worker.test.ts
git commit -m "feat: worker literature stage executor with scholarly retrieval"
```

---

## Task 10: Detail page — stage timeline + literature renderer

**Files:**
- Modify: `src/app/research/[projectId]/page.tsx`
- Test: `tests/research-pages.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `tests/research-pages.test.tsx` cases (mirror the existing render test's mocking of `getResearchProjectDetail` / `requireCurrentUser`):
  - A project with a `plan` stage artifact renders the plan section (e.g. "How this extends the source paper").
  - A project with `status: "literature_ready"` and a `literature` stage artifact renders the literature section (e.g. a "Related work" heading and the `positioning` text).
  - A project with `status: "running"` and only a queued literature stage job renders a "being generated" / in-progress note for literature.

The detail now reads `project.stageJobs` + `project.stageArtifacts` (not `project.plan`/`project.planJob`). Build the mocked `getResearchProjectDetail` return value with `stageArtifacts: [{ stageType: "literature", artifactJson: JSON.stringify(<LiteratureReview>) }, ...]` and `stageJobs: [{ stageType, status, errorMessage }]`.

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run tests/research-pages.test.tsx` → FAIL.

- [ ] **Step 3: Implement.** Rewrite `src/app/research/[projectId]/page.tsx` to render from `stageArtifacts`/`stageJobs`. Replace the plan-only parsing + section with a stage-driven render. Key changes:

```tsx
import { LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";
import { RESEARCH_STAGES } from "@/lib/research/stages";

// ...inside the component, after `if (!project) notFound();`
const artifactByStage = new Map(project.stageArtifacts.map((a) => [a.stageType, a]));
const jobByStage = new Map(project.stageJobs.map((j) => [j.stageType, j]));

const planArtifact = artifactByStage.get("plan");
const plan = planArtifact
  ? (() => {
      const r = ResearchPlanSchema.safeParse(JSON.parse(planArtifact.artifactJson));
      return r.success ? r.data : null;
    })()
  : null;

const litArtifact = artifactByStage.get("literature");
const literature = litArtifact
  ? (() => {
      const r = LiteratureReviewSchema.safeParse(JSON.parse(litArtifact.artifactJson));
      return r.success ? r.data : null;
    })()
  : null;
```

Keep the existing header (it already uses `project.currentStage` + `StatusBadge`). Replace the single plan `section` with: a small **stage timeline** (each stage in `RESEARCH_STAGES` with `jobByStage.get(stage)?.status ?? "not started"`), then the plan section (unchanged markup, gated on `plan`), then a new literature section gated on `literature`:

```tsx
<section className="mb-4 flex flex-wrap gap-2">
  {RESEARCH_STAGES.map((stage) => {
    const status = jobByStage.get(stage)?.status ?? (artifactByStage.has(stage) ? "completed" : "not started");
    return (
      <span key={stage} className="rounded border border-rf-border bg-rf-surface px-2 py-0.5 text-xs text-rf-muted">
        {stage}: <span className="text-rf-white">{status.replaceAll("_", " ")}</span>
      </span>
    );
  })}
</section>

{/* existing plan section, gated on `plan` (unchanged markup) */}

{literature ? (
  <section className="mt-4 grid gap-4 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
    <div>
      <h2 className="text-lg font-semibold text-rf-white">Literature review</h2>
      <p className="mt-1">{literature.relationToSourcePaper}</p>
    </div>
    <div>
      <h3 className="font-semibold text-rf-white">Positioning</h3>
      <p className="mt-1">{literature.positioning}</p>
    </div>
    <div>
      <h3 className="font-semibold text-rf-white">Related work</h3>
      <ul className="mt-1 grid gap-2">
        {literature.relatedWorks.map((work, index) => (
          <li key={`${work.title}-${index}`}>
            <span className="text-rf-white">{work.title}</span> — {work.summary}{" "}
            <span className="text-rf-muted">({work.relationToProposed})</span>
          </li>
        ))}
      </ul>
    </div>
    <PlanList title="Themes" items={literature.themes} />
    <PlanList title="Gaps" items={literature.gaps} />
    <div>
      <h3 className="font-semibold text-rf-white">Citations</h3>
      <ul className="mt-1 grid gap-1">
        {literature.citations.map((citation, index) => (
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

Update the "not yet ready" fallback to use `jobByStage` instead of `project.planJob` — render the failed/aborted/in-progress note based on `project.status` and `jobByStage.get(project.currentStage)?.errorMessage`. (`PlanList` is already defined in this file and is reused.)

- [ ] **Step 4: Run the test to verify it passes** — `npx vitest run tests/research-pages.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/research/[projectId]/page.tsx" tests/research-pages.test.tsx
git commit -m "feat: render research stage timeline and literature artifact"
```

---

## Task 11: Full verification

- [ ] **Step 1:** `npx tsc --noEmit` → exit 0. (Watch for leftover references to `researchPlanJob`/`ResearchPlan`/`completeResearchPlanJob`/`parseResearchPlanOutput` — grep the repo: `npx --yes rg "researchPlanJob|ResearchPlan\b|completeResearchPlanJob|parseResearchPlanOutput" src scripts` should return nothing except `ResearchPlanSchema`/`ResearchPlanJobInput*` which remain.)
- [ ] **Step 2:** `npx eslint` on all created/changed files → exit 0.
- [ ] **Step 3:** Full suite on a clean DB: `TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npx vitest run --no-file-parallelism --testTimeout 60000` → all pass. (If any pre-existing test still seeds `researchPlanJob`/`researchPlan`, update it to the generic tables.)
- [ ] **Step 4:** `npm run build` → compiles.
- [ ] **Step 5:** Final whole-branch review (subagent-driven final reviewer) over the full diff vs `main`, focusing on the migration data-copy correctness, the abort-gated advance, and source-paper grounding on both stages.

---

## Self-review notes (author)

- **Spec coverage:** generic data model + migration (T3), stage registry + advance (T2, T5), literature schema (T1), literature input incl. plan artifact (T7), worker retrieval executor (T9), generic claim/complete routes + lanes (T7, T8), output validation (T6), UI timeline + literature renderer (T10), verification (T11). Develop/abort/observability invariants preserved (T4, T10).
- **Type consistency:** `ResearchStage`/`RESEARCH_STAGES`/`EXECUTABLE_STAGES`/`nextExecutableStage`/`STAGE_REGISTRY` (T2) used in completion (T5) and validation (T6). `ResearchStageJob`/`ResearchStageArtifact` (T3) used everywhere. `LiteratureReviewSchema`/`LiteratureJobInputSchema` (T1) used in registry (T2), claim (T7), worker (T9), UI (T10). Worker job-type strings `research_plan`/`research_literature` consistent across lanes (T7), claim (T7), complete (T8), worker payload parsing (T9).
- **Migration safety:** copies existing plan rows forward (as `stageType='plan'`) before dropping the old tables; safe whether prod has plan data or not.
- **Ordering caveat:** Tasks 4 and 5 split the `research.ts` rewrite; the file/suite is only fully green after Task 5. Run them back-to-back.
