# Autonomous Research Harness & Plan Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user "Develop" a generated idea into a `ResearchProject` that autonomously runs a first stage — turning the idea + its viability result into a structured, source-paper-grounded research plan — with the spine built to extend to later stages with no rework.

**Architecture:** Each pipeline stage is a worker job mirroring the existing `viability_check` job; the local Codex worker runs it and posts a structured result; the harness advances to the next stage on completion. This sub-project implements the spine + the `plan` stage only. The source paper rides every stage's input and must be cited (enforced at completion), so the eventual paper cannot drop the original.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Prisma/Postgres, Zod, Vitest + Testing Library, the local Codex worker.

**Reference spec:** `docs/superpowers/specs/2026-06-25-autonomous-research-harness-and-plan-stage-design.md`

**Postgres test command (bash, inline env — the `.env` `TEST_DATABASE_URL` points at an unused port 54329; override to 5432):**
```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/<file> --no-file-parallelism --testTimeout 60000
```
Postgres-backed tests run `prisma db push` from `prisma/schema.prisma`, so updating the schema is sufficient for tests; the migration SQL (Task 2) is for prod deploy.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/v2/domain.ts` | Enums/constants | Add `RESEARCH_STAGES`, `RESEARCH_PROJECT_STATUSES` |
| `src/lib/v2/schemas.ts` | Zod contracts | Add `ResearchPlanSchema`, `ResearchPlanJobInputSchema` |
| `prisma/schema.prisma` | DB models | Add `ResearchProject`, `ResearchPlanJob`, `ResearchPlan` + back-relations |
| `prisma/migrations/20260625180000_autonomous_research_harness/migration.sql` | Prod migration | Create |
| `src/lib/jobs/research.ts` | Plan-stage lifecycle + harness advance | Create |
| `src/app/api/workers/claim/route.ts` | Worker claim | Add `research_plan` branch |
| `src/app/api/workers/jobs/[jobId]/complete/route.ts` | Worker completion | Add `research_plan` branch |
| `src/worker/output-validation.ts` | Output parsing | Add `parseResearchPlanOutput` |
| `scripts/researchfinder-worker.ts` | Local worker | Add `research_plan` executor + prompt |
| `src/app/research/actions.ts` | Server actions | Create (`developIdea`, `abortResearchProject`) |
| `src/components/IdeaCard.tsx` | Idea UI | Add "Develop this" button |
| `src/app/research/page.tsx` | Projects list | Create |
| `src/app/research/[projectId]/page.tsx` | Project detail | Create |
| Tests | see each task | Create/extend |

---

## Task 1: Domain constants + Zod schemas

**Files:**
- Modify: `src/lib/v2/domain.ts`
- Modify: `src/lib/v2/schemas.ts`
- Test: `tests/research-schemas.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/research-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ResearchPlanSchema } from "@/lib/v2/schemas";

const sourcePaperCitation = {
  sourceType: "paper" as const,
  url: "https://arxiv.org/abs/2501.00001",
  sourceId: "2501.00001",
  title: "Source paper",
  claim: "The original method this work extends.",
  confidence: 0.9
};

const validPlan = {
  researchProjectId: "proj-1",
  relationToSourcePaper: "Extends the source method with X.",
  hypotheses: ["H1: X improves Y."],
  experimentalDesign: "Ablation across three settings.",
  protocolSteps: ["Step 1: build baseline.", "Step 2: run ablation."],
  datasets: ["CIFAR-10"],
  baselines: ["ResNet-18"],
  metrics: ["accuracy"],
  successCriteria: ["Beats baseline by >1%."],
  computeEstimate: "1 GPU-day",
  risks: ["Dataset shift."],
  citations: [sourcePaperCitation]
};

describe("ResearchPlanSchema", () => {
  it("accepts a complete, grounded plan", () => {
    expect(ResearchPlanSchema.parse(validPlan)).toMatchObject({ researchProjectId: "proj-1" });
  });

  it("rejects a missing relationToSourcePaper", () => {
    const { relationToSourcePaper: _omit, ...rest } = validPlan;
    expect(ResearchPlanSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects empty hypotheses, protocolSteps, successCriteria, or citations", () => {
    expect(ResearchPlanSchema.safeParse({ ...validPlan, hypotheses: [] }).success).toBe(false);
    expect(ResearchPlanSchema.safeParse({ ...validPlan, protocolSteps: [] }).success).toBe(false);
    expect(ResearchPlanSchema.safeParse({ ...validPlan, successCriteria: [] }).success).toBe(false);
    expect(ResearchPlanSchema.safeParse({ ...validPlan, citations: [] }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(ResearchPlanSchema.safeParse({ ...validPlan, extra: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
npm test -- tests/research-schemas.test.ts
```
Expected: FAIL — `ResearchPlanSchema` is not exported yet.

- [ ] **Step 3: Add domain constants** — append to `src/lib/v2/domain.ts`:

```ts
export const RESEARCH_STAGES = ["plan", "literature", "experiment", "analysis", "paper"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

export const RESEARCH_PROJECT_STATUSES = ["running", "plan_ready", "aborted", "failed"] as const;
export type ResearchProjectStatus = (typeof RESEARCH_PROJECT_STATUSES)[number];
```

- [ ] **Step 4: Add Zod schemas** — in `src/lib/v2/schemas.ts`, add these after the `ViabilityResultSchema` block (they use the module-private `NonEmptyTrimmedStringSchema`, `RequiredUrlSchema`, `CitationSchema` already defined in this file):

```ts
export const ResearchPlanSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: NonEmptyTrimmedStringSchema,
  hypotheses: z.array(NonEmptyTrimmedStringSchema).min(1),
  experimentalDesign: NonEmptyTrimmedStringSchema,
  protocolSteps: z.array(NonEmptyTrimmedStringSchema).min(1),
  datasets: z.array(NonEmptyTrimmedStringSchema),
  baselines: z.array(NonEmptyTrimmedStringSchema),
  metrics: z.array(NonEmptyTrimmedStringSchema),
  successCriteria: z.array(NonEmptyTrimmedStringSchema).min(1),
  computeEstimate: NonEmptyTrimmedStringSchema,
  risks: z.array(NonEmptyTrimmedStringSchema),
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
    publishedAt: NonEmptyTrimmedStringSchema
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

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
export type ResearchPlanJobInput = z.infer<typeof ResearchPlanJobInputSchema>;
```

- [ ] **Step 5: Run the test to verify it passes**

```
npm test -- tests/research-schemas.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/v2/domain.ts src/lib/v2/schemas.ts tests/research-schemas.test.ts
git commit -m "feat: add research plan domain constants and schemas"
```

---

## Task 2: Prisma models + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260625180000_autonomous_research_harness/migration.sql`
- Test: `tests/prisma-schema-shape.test.ts` (extend if it asserts model presence) — otherwise covered by Task 3's Postgres tests.

- [ ] **Step 1: Add models** — append to `prisma/schema.prisma`:

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

  user          User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  generatedIdea GeneratedIdea    @relation(fields: [generatedIdeaId], references: [id], onDelete: Cascade)
  planJob       ResearchPlanJob?
  plan          ResearchPlan?

  @@index([userId, status, createdAt, id])
}

model ResearchPlanJob {
  id                String    @id @default(cuid())
  researchProjectId String    @unique
  userId            String
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

  @@index([userId, status, createdAt, id])
  @@index([claimedByWorkerId, status])
}

model ResearchPlan {
  id                String   @id @default(cuid())
  researchProjectId String   @unique
  planJson          String
  createdAt         DateTime @default(now())

  researchProject ResearchProject @relation(fields: [researchProjectId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Add back-relations** — Prisma requires the inverse relation fields. In `model User { ... }` add:

```prisma
  researchProjects ResearchProject[]
  researchPlanJobs ResearchPlanJob[]
```

In `model GeneratedIdea { ... }` add:

```prisma
  researchProjects ResearchProject[]
```

- [ ] **Step 3: Validate + regenerate the client**

```
npx prisma validate
npx prisma generate
```
Expected: both succeed (validate prints "The schema ... is valid").

- [ ] **Step 4: Hand-author the prod migration** — create `prisma/migrations/20260625180000_autonomous_research_harness/migration.sql` (mirrors Prisma's generated DDL conventions, matching the existing migrations):

```sql
-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generatedIdeaId" TEXT NOT NULL,
    "sourceViabilityJobId" TEXT,
    "status" TEXT NOT NULL,
    "currentStage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchPlanJob" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "claimedByWorkerId" TEXT,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchPlanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchPlan" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "planJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchProject_userId_status_createdAt_id_idx" ON "ResearchProject"("userId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPlanJob_researchProjectId_key" ON "ResearchPlanJob"("researchProjectId");

-- CreateIndex
CREATE INDEX "ResearchPlanJob_userId_status_createdAt_id_idx" ON "ResearchPlanJob"("userId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ResearchPlanJob_claimedByWorkerId_status_idx" ON "ResearchPlanJob"("claimedByWorkerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPlan_researchProjectId_key" ON "ResearchPlan"("researchProjectId");

-- AddForeignKey
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_generatedIdeaId_fkey" FOREIGN KEY ("generatedIdeaId") REFERENCES "GeneratedIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlanJob" ADD CONSTRAINT "ResearchPlanJob_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlanJob" ADD CONSTRAINT "ResearchPlanJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlan" ADD CONSTRAINT "ResearchPlan_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Save as UTF-8 **without a BOM** (a prior migration BOM caused a bug — see commit `55ee5b8`).

- [ ] **Step 5: Confirm the schema pushes cleanly** — run any existing Postgres test to exercise `prisma db push` against the new schema:

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/prisma-schema-shape.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS (proves the new models push without error).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260625180000_autonomous_research_harness/migration.sql
git commit -m "feat: add research project, plan job, and plan models"
```

---

## Task 3: Plan-stage lifecycle + harness advance

**Files:**
- Create: `src/lib/jobs/research.ts`
- Test: `tests/research-lifecycle.test.ts` (create)

This file owns: `developIdea`, `claimNextResearchPlanJob`, `completeResearchPlanJob` (with source-paper grounding + advance rule), `abortResearchProject`, and read helpers for the pages.

- [ ] **Step 1: Write the failing test** — create `tests/research-lifecycle.test.ts`:

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

async function seedIdea(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "researcher@example.com" } });
  const paper = await client.paper.create({
    data: {
      arxivId: "2501.00001",
      title: "Source paper",
      abstract: "Abstract",
      url: "https://arxiv.org/abs/2501.00001",
      publishedAt: new Date(),
      arxivUpdatedAt: new Date(),
      authorsJson: "[]",
      categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id,
      paperId: paper.id,
      inboxDate: "2026-06-25",
      title: "Idea title",
      summary: "Idea summary",
      expandedExplanation: "Expanded explanation",
      trajectory: "Trajectory",
      recommended: true,
      noveltyStatus: "not_checked",
      relevanceScore: 0.8,
      significanceScore: 0.8,
      originalityScore: 0.8,
      feasibilityScore: 0.8,
      overallScore: 0.8,
      scoreExplanationsJson: "{}",
      risksJson: "[]",
      smallestSprint: "Smallest sprint",
      generatedBy: "codex"
    }
  });
  return { user, paper, idea };
}

function planOutput(researchProjectId: string, paper: { arxivId: string; url: string }) {
  return {
    researchProjectId,
    relationToSourcePaper: "Extends the source paper method.",
    hypotheses: ["H1."],
    experimentalDesign: "Design.",
    protocolSteps: ["Step 1."],
    datasets: ["D"],
    baselines: ["B"],
    metrics: ["accuracy"],
    successCriteria: ["Beats baseline."],
    computeEstimate: "1 GPU-day",
    risks: ["Risk."],
    citations: [
      {
        sourceType: "paper" as const,
        url: paper.url,
        sourceId: paper.arxivId,
        title: "Source paper",
        claim: "Original method.",
        confidence: 0.9
      }
    ]
  };
}

describe("research plan lifecycle", () => {
  it("developIdea creates a running project + queued plan job, and is idempotent", async () => {
    const { developIdea } = await import("@/lib/jobs/research");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, idea } = await seedIdea(client);

      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      expect(project.status).toBe("running");
      expect(project.currentStage).toBe("plan");

      const job = await client.researchPlanJob.findUniqueOrThrow({
        where: { researchProjectId: project.id }
      });
      expect(job.status).toBe("queued");

      const again = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      expect(again.id).toBe(project.id);
      expect(await client.researchProject.count()).toBe(1);
    });
  });

  it("completing the plan job persists the plan and advances to plan_ready", async () => {
    const { developIdea, claimNextResearchPlanJob, completeResearchPlanJob } = await import(
      "@/lib/jobs/research"
    );
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, paper, idea } = await seedIdea(client);
      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });

      const claimed = await claimNextResearchPlanJob({ userId: user.id, workerId: "w1" });
      expect(claimed?.researchProjectId).toBe(project.id);

      await completeResearchPlanJob({
        jobId: claimed!.id,
        workerId: "w1",
        output: planOutput(project.id, paper)
      });

      const refreshed = await client.researchProject.findUniqueOrThrow({ where: { id: project.id } });
      expect(refreshed.status).toBe("plan_ready");
      const plan = await client.researchPlan.findUniqueOrThrow({
        where: { researchProjectId: project.id }
      });
      expect(JSON.parse(plan.planJson).relationToSourcePaper).toContain("Extends");
    });
  });

  it("rejects completion when the plan omits the source-paper citation", async () => {
    const { developIdea, claimNextResearchPlanJob, completeResearchPlanJob } = await import(
      "@/lib/jobs/research"
    );
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, paper, idea } = await seedIdea(client);
      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const claimed = await claimNextResearchPlanJob({ userId: user.id, workerId: "w1" });

      const bad = planOutput(project.id, paper);
      bad.citations = [
        {
          sourceType: "web" as unknown as "paper",
          url: "https://example.com",
          sourceId: "x",
          title: "Unrelated",
          claim: "Unrelated.",
          confidence: 0.5
        }
      ];

      await expect(
        completeResearchPlanJob({ jobId: claimed!.id, workerId: "w1", output: bad })
      ).rejects.toThrow();
      expect(await client.researchPlan.count()).toBe(0);
    });
  });

  it("does not advance an aborted project on completion", async () => {
    const { developIdea, claimNextResearchPlanJob, completeResearchPlanJob, abortResearchProject } =
      await import("@/lib/jobs/research");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { user, paper, idea } = await seedIdea(client);
      const project = await developIdea({ currentUserId: user.id, generatedIdeaId: idea.id });
      const claimed = await claimNextResearchPlanJob({ userId: user.id, workerId: "w1" });

      await abortResearchProject({ currentUserId: user.id, researchProjectId: project.id });
      await completeResearchPlanJob({
        jobId: claimed!.id,
        workerId: "w1",
        output: planOutput(project.id, paper)
      });

      const refreshed = await client.researchProject.findUniqueOrThrow({ where: { id: project.id } });
      expect(refreshed.status).toBe("aborted");
      expect(await client.researchPlan.count()).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/research-lifecycle.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — `@/lib/jobs/research` does not exist.

- [ ] **Step 3: Implement `src/lib/jobs/research.ts`**

```ts
import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";
import { type Citation, ResearchPlanSchema, ViabilityResultSchema } from "@/lib/v2/schemas";

const MAX_CLAIM_ATTEMPTS = 3;

export async function developIdea(input: { currentUserId: string; generatedIdeaId: string }) {
  const idea = await prisma.generatedIdea.findUnique({
    where: { id: input.generatedIdeaId },
    select: { id: true, userId: true }
  });

  if (
    !idea ||
    !canDispatchIdeaForProfile({
      currentUserId: input.currentUserId,
      generatedForUserId: idea.userId
    })
  ) {
    throw new Error("Generated idea is not available for development by this user");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.researchProject.findFirst({
      where: { generatedIdeaId: idea.id, userId: input.currentUserId, status: { not: "aborted" } },
      orderBy: { createdAt: "desc" }
    });
    if (existing) return existing;

    const latestViability = await tx.viabilityJob.findFirst({
      where: { generatedIdeaId: idea.id, userId: input.currentUserId, status: "completed" },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });

    const project = await tx.researchProject.create({
      data: {
        userId: input.currentUserId,
        generatedIdeaId: idea.id,
        sourceViabilityJobId: latestViability?.id ?? null,
        status: "running",
        currentStage: "plan"
      }
    });

    await tx.researchPlanJob.create({
      data: {
        researchProjectId: project.id,
        userId: input.currentUserId,
        status: "queued",
        inputJson: JSON.stringify({ researchProjectId: project.id })
      }
    });

    return project;
  });
}

export async function claimNextResearchPlanJob(input: { userId: string; workerId: string }) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const staleStartedBefore = staleRunningJobStartedBefore();
    const job = await prisma.researchPlanJob.findFirst({
      where: {
        userId: input.userId,
        researchProject: { status: { not: "aborted" } },
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleStartedBefore } }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (!job) return null;

    const claim = await prisma.researchPlanJob.updateMany({
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

    return prisma.researchPlanJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        researchProject: {
          include: {
            generatedIdea: { include: { paper: true, citations: true } }
          }
        }
      }
    });
  }

  return null;
}

export async function completeResearchPlanJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  const parsed = ResearchPlanSchema.parse(input.output);

  await prisma.$transaction(async (tx) => {
    const job = await tx.researchPlanJob.findFirst({
      where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
      include: {
        researchProject: {
          include: { generatedIdea: { include: { paper: true } } }
        }
      }
    });

    if (!job) {
      throw new Error("Research plan job is no longer running");
    }

    if (parsed.researchProjectId !== job.researchProjectId) {
      throw new Error("Research plan output does not match the claimed project");
    }

    const sourcePaper = job.researchProject.generatedIdea.paper;
    assertCitesSourcePaper(parsed.citations, {
      id: sourcePaper.id,
      arxivId: sourcePaper.arxivId,
      url: sourcePaper.url
    });

    const completion = await tx.researchPlanJob.updateMany({
      where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
      data: { status: "completed", outputJson: JSON.stringify(parsed), completedAt: new Date() }
    });

    if (completion.count !== 1) {
      throw new Error("Research plan job is no longer running");
    }

    // Abort guard: a project aborted while the stage ran keeps its terminal state;
    // the job is recorded completed above but no artifact is persisted and no advance happens.
    if (job.researchProject.status === "aborted") {
      return;
    }

    await tx.researchPlan.create({
      data: { researchProjectId: job.researchProjectId, planJson: JSON.stringify(parsed) }
    });

    // Harness advance: no stage after `plan` has an executor yet, so the project
    // lands at plan_ready. A later sub-project replaces this with "enqueue next stage".
    await tx.researchProject.update({
      where: { id: job.researchProjectId },
      data: { status: "plan_ready" }
    });
  });
}

export async function abortResearchProject(input: {
  currentUserId: string;
  researchProjectId: string;
}) {
  const project = await prisma.researchProject.findUnique({
    where: { id: input.researchProjectId },
    select: { userId: true }
  });

  if (!project || project.userId !== input.currentUserId) {
    throw new Error("Research project is not available to this user");
  }

  await prisma.researchProject.update({
    where: { id: input.researchProjectId },
    data: { status: "aborted" }
  });
}

export async function listResearchProjectsForUser(userId: string) {
  return prisma.researchProject.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { generatedIdea: { select: { title: true } } }
  });
}

export async function getResearchProjectDetail(input: { currentUserId: string; projectId: string }) {
  const project = await prisma.researchProject.findUnique({
    where: { id: input.projectId },
    include: {
      generatedIdea: { include: { paper: true } },
      planJob: true,
      plan: true
    }
  });

  if (!project || project.userId !== input.currentUserId) return null;
  return project;
}

function assertCitesSourcePaper(
  citations: Citation[],
  sourcePaper: { id: string; arxivId: string; url: string }
) {
  const validSourceIds = new Set([sourcePaper.arxivId, sourcePaper.id]);
  let citesSourcePaper = false;

  for (const citation of citations) {
    if (citation.sourceType !== "paper") continue;

    const matches =
      citation.url === sourcePaper.url &&
      citation.sourceId !== undefined &&
      validSourceIds.has(citation.sourceId);

    if (!matches) {
      throw new Error("Research plan source paper citation does not match the project source paper");
    }

    citesSourcePaper = true;
  }

  if (!citesSourcePaper) {
    throw new Error("Research plan must cite the project source paper");
  }
}

export function buildViabilityContextFromArtifactContent(content: string) {
  try {
    const parsed = ViabilityResultSchema.safeParse(JSON.parse(content));
    if (!parsed.success) return null;
    return {
      verdict: parsed.data.verdict,
      summary: parsed.data.summary,
      feasibility: parsed.data.feasibility,
      noveltyRisk: parsed.data.noveltyRisk,
      minimumExperiment: parsed.data.minimumExperiment,
      blockers: parsed.data.blockers
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/research-lifecycle.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/research.ts tests/research-lifecycle.test.ts
git commit -m "feat: add research plan job lifecycle with source-paper grounding"
```

---

## Task 4: Worker claim + completion routes

**Files:**
- Modify: `src/app/api/workers/claim/route.ts`
- Modify: `src/app/api/workers/jobs/[jobId]/complete/route.ts`
- Test: `tests/research-worker-routes.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/research-worker-routes.test.ts` (Postgres-backed; drives the route handlers directly):

```ts
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null, worker: null as { id: string; userId: string } | null }));

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

async function seedProjectWithClaimableJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "worker-routes@example.com" } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w", tokenHash: "h", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: "2502.00002",
      title: "Src",
      abstract: "A",
      url: "https://arxiv.org/abs/2502.00002",
      publishedAt: new Date(),
      arxivUpdatedAt: new Date(),
      authorsJson: "[]",
      categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id, paperId: paper.id, inboxDate: "2026-06-25",
      title: "T", summary: "S", expandedExplanation: "E", trajectory: "Tr",
      recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8,
      feasibilityScore: 0.8, overallScore: 0.8, scoreExplanationsJson: "{}",
      risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  await client.researchPlanJob.create({
    data: { researchProjectId: project.id, userId: user.id, status: "queued", inputJson: JSON.stringify({ researchProjectId: project.id }) }
  });
  return { user, worker, paper, project };
}

describe("research_plan worker routes", () => {
  it("claims a research_plan job and returns a valid input", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithClaimableJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId };

      const response = await POST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST",
          headers: { authorization: "Bearer t" }
        })
      );
      const payload = (await response.json()) as { job: { type: string; input: { researchProjectId: string; paper: { arxivId: string } } } };
      expect(payload.job.type).toBe("research_plan");
      expect(payload.job.input.paper.arxivId).toBe("2502.00002");
      expect(typeof payload.job.input.researchProjectId).toBe("string");
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/research-worker-routes.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — the claim route does not return `research_plan` yet.

- [ ] **Step 3: Extend the claim route** — in `src/app/api/workers/claim/route.ts`:

Add imports:
```ts
import { claimNextResearchPlanJob, buildViabilityContextFromArtifactContent } from "@/lib/jobs/research";
import { ResearchPlanJobInputSchema, type ResearchPlanJobInput } from "@/lib/v2/schemas";
```

In the `if (!job) { ... }` block, **after** the viability branch and **before** the final `return NextResponse.json({ job: null });`, insert:

```ts
    if (!viabilityJob) {
      const researchPlanJob = await claimNextResearchPlanJob({
        userId: worker.userId,
        workerId: worker.id
      });

      if (!researchPlanJob) {
        return NextResponse.json({ job: null });
      }

      try {
        return NextResponse.json({
          job: {
            type: "research_plan",
            id: researchPlanJob.id,
            input: await buildResearchPlanJobInput(researchPlanJob)
          }
        });
      } catch (error) {
        await prisma.researchPlanJob.update({
          where: { id: researchPlanJob.id },
          data: { status: "failed", errorMessage: formatErrorMessage(error), completedAt: new Date() }
        });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
```

(Replace the current `if (!viabilityJob) { return NextResponse.json({ job: null }); }` with the block above — it now claims a research plan job instead of returning null immediately.)

Add this input builder at the bottom of the file:

```ts
type ClaimedResearchPlanJob = NonNullable<Awaited<ReturnType<typeof claimNextResearchPlanJob>>>;

async function buildResearchPlanJobInput(job: ClaimedResearchPlanJob): Promise<ResearchPlanJobInput> {
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
      id: idea.id,
      title: idea.title,
      summary: idea.summary,
      expandedExplanation: idea.expandedExplanation,
      trajectory: idea.trajectory,
      smallestSprint: idea.smallestSprint
    },
    paper: {
      id: paper.id,
      arxivId: paper.arxivId,
      title: paper.title,
      abstract: paper.abstract,
      url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    viability,
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType,
      title: citation.title,
      url: citation.url,
      sourceId: citation.sourceId ?? undefined,
      claim: citation.claim,
      confidence: citation.confidence
    }))
  });
}
```

(`parseJsonArray` and `formatErrorMessage` already exist in this file.)

- [ ] **Step 4: Extend the completion route** — in `src/app/api/workers/jobs/[jobId]/complete/route.ts`:

Add import:
```ts
import { completeResearchPlanJob } from "@/lib/jobs/research";
```

Widen the type:
```ts
type WorkerJobType = "inbox_generation" | "novelty_scan" | "viability_check" | "research_plan";
```

In the dispatch chain inside `POST`, change the final `else` to an explicit branch and add research_plan:
```ts
    } else if (jobType === "viability_check") {
      await completeV2ViabilityJob({ jobId, workerId: worker.id, output: body.output });
    } else {
      await completeResearchPlanJob({ jobId, workerId: worker.id, output: body.output });
    }
```

In `markWorkerJobFailed`, add before the final viability line:
```ts
  if (input.jobType === "research_plan") {
    await prisma.researchPlanJob.updateMany({ where, data });
    return;
  }
```

In `resolveJobType`, widen the `requestedType` guard to include `"research_plan"`, and add a lookup after the viability check:
```ts
  const requestedType =
    input.requestedType === "inbox_generation" ||
    input.requestedType === "novelty_scan" ||
    input.requestedType === "viability_check" ||
    input.requestedType === "research_plan"
      ? input.requestedType
      : null;
```
```ts
  if (viabilityJob) {
    return requestedType && requestedType !== "viability_check" ? null : "viability_check";
  }

  const researchPlanJob = await prisma.researchPlanJob.findFirst({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    select: { id: true }
  });

  if (!researchPlanJob) return null;
  return requestedType && requestedType !== "research_plan" ? null : "research_plan";
```
(Change the prior `if (!viabilityJob) return null;` to `if (viabilityJob) { ... }` returning viability, so the function can continue to the research_plan check.)

- [ ] **Step 5: Run the test to verify it passes**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/research-worker-routes.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 6: Run the existing worker-route tests to confirm no regression**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-claim-route.test.ts tests/candidates-cron-route.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/workers/claim/route.ts" "src/app/api/workers/jobs/[jobId]/complete/route.ts" tests/research-worker-routes.test.ts
git commit -m "feat: route research_plan worker jobs"
```

---

## Task 5: Local worker executor + prompt + output validation

**Files:**
- Modify: `src/worker/output-validation.ts`
- Modify: `scripts/researchfinder-worker.ts`
- Test: `tests/research-worker-output.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/research-worker-output.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseResearchPlanOutput } from "@/worker/output-validation";

describe("parseResearchPlanOutput", () => {
  it("parses a valid plan JSON string", () => {
    const raw = JSON.stringify({
      researchProjectId: "p1",
      relationToSourcePaper: "Extends it.",
      hypotheses: ["H1"],
      experimentalDesign: "D",
      protocolSteps: ["S1"],
      datasets: ["D1"],
      baselines: ["B1"],
      metrics: ["m"],
      successCriteria: ["beats baseline"],
      computeEstimate: "1 GPU-day",
      risks: ["r"],
      citations: [
        {
          sourceType: "paper",
          url: "https://arxiv.org/abs/2501.00001",
          sourceId: "2501.00001",
          title: "Src",
          claim: "c",
          confidence: 0.9
        }
      ]
    });
    expect(parseResearchPlanOutput(raw).researchProjectId).toBe("p1");
  });

  it("throws on malformed JSON", () => {
    expect(() => parseResearchPlanOutput("not json")).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
npm test -- tests/research-worker-output.test.ts
```
Expected: FAIL — `parseResearchPlanOutput` is not exported.

- [ ] **Step 3: Add the output parser** — in `src/worker/output-validation.ts`:

```ts
import {
  GeneratedInboxSchema,
  NoveltyScanResultSchema,
  ResearchPlanSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";
```
```ts
export function parseResearchPlanOutput(raw: string) {
  return ResearchPlanSchema.parse(JSON.parse(raw));
}
```

- [ ] **Step 4: Run the parser test to verify it passes**

```
npm test -- tests/research-worker-output.test.ts
```
Expected: PASS.

- [ ] **Step 5: Wire the worker executor** — in `scripts/researchfinder-worker.ts`:

Add imports:
```ts
import { ResearchPlanJobInputSchema, type ResearchPlanJobInput } from "@/lib/v2/schemas";
import { parseResearchPlanOutput } from "@/worker/output-validation";
```
(extend the existing `@/lib/v2/schemas` and `@/worker/output-validation` import lines rather than duplicating them).

In `parseClaimPayload`, widen the job-type guard to accept `research_plan`:
```ts
  if (
    job.type !== "inbox_generation" &&
    job.type !== "novelty_scan" &&
    job.type !== "viability_check" &&
    job.type !== "research_plan"
  ) {
    throw new FatalWorkerError(`Unsupported worker job type: ${String(job.type)}`);
  }
```

In `runResearchFinderWorkerOnce`, add a branch after the `viability_check` branch and before the final `throw new FatalWorkerError(...)`:
```ts
  if (payload.job.type === "research_plan") {
    const result = await runResearchPlanJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }
```

Add the executor + prompt (mirroring `runViabilityJob` / `buildViabilityPrompt`):
```ts
async function runResearchPlanJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseResearchPlanJobInput(job.input);
  const prompt = await writeResearchPlanPrompt(job.id, input);

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
      return { output: parseResearchPlanOutput(rawOutput) };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    await rm(prompt.dir, { force: true, recursive: true });
  }
}

function parseResearchPlanJobInput(value: unknown) {
  try {
    return ResearchPlanJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(
      `Research plan job input failed validation: ${formatErrorMessage(error)}`
    );
  }
}

async function writeResearchPlanPrompt(jobId: string, input: ResearchPlanJobInput) {
  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-research-plan-"));
  const promptFile = join(promptDir, `${jobId}.prompt.md`);
  await writeFile(promptFile, buildResearchPlanPrompt(input), "utf8");
  return { dir: promptDir, file: promptFile };
}

function buildResearchPlanPrompt(input: ResearchPlanJobInput) {
  return [
    "You are turning a viability-checked research idea into a concrete, executable research plan.",
    "Return only valid JSON matching the ResearchPlan schema exactly. Do not wrap it in Markdown.",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    "Required keys: researchProjectId, relationToSourcePaper, hypotheses (>=1), experimentalDesign,",
    "protocolSteps (>=1, ordered), datasets, baselines, metrics, successCriteria (>=1),",
    "computeEstimate, risks, citations (>=1).",
    "Ground the plan in the source paper: relationToSourcePaper must explain how this work extends it,",
    "and citations MUST include the source paper as sourceType \"paper\" with its exact url and sourceId.",
    "Keep the plan to the smallest credible experiment that tests the core hypothesis.",
    "",
    "Claimed job input:",
    JSON.stringify(input, null, 2)
  ].join("\n");
}
```

- [ ] **Step 6: Run the worker tests + typecheck**

```
npm test -- tests/research-worker-output.test.ts tests/researchfinder-worker.test.ts
npx tsc --noEmit --pretty false
```
Expected: PASS and exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/worker/output-validation.ts scripts/researchfinder-worker.ts tests/research-worker-output.test.ts
git commit -m "feat: run research plan jobs in the local worker"
```

---

## Task 6: Develop button + abort action

**Files:**
- Create: `src/app/research/actions.ts`
- Modify: `src/components/IdeaCard.tsx`
- Test: `tests/research-actions.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/research-actions.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  developIdea: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: mocked.requireCurrentUser }));
vi.mock("@/lib/jobs/research", () => ({
  developIdea: mocked.developIdea,
  abortResearchProject: vi.fn()
}));
vi.mock("next/navigation", () => ({ redirect: mocked.redirect }));

afterEach(() => vi.clearAllMocks());

describe("developIdeaAction", () => {
  it("develops the idea and redirects to the project page", async () => {
    mocked.requireCurrentUser.mockResolvedValue({ id: "user-1" });
    mocked.developIdea.mockResolvedValue({ id: "proj-9" });
    const { developIdeaAction } = await import("@/app/research/actions");

    const form = new FormData();
    form.set("generatedIdeaId", "idea-1");
    await developIdeaAction(form);

    expect(mocked.developIdea).toHaveBeenCalledWith({ currentUserId: "user-1", generatedIdeaId: "idea-1" });
    expect(mocked.redirect).toHaveBeenCalledWith("/research/proj-9");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
npm test -- tests/research-actions.test.ts
```
Expected: FAIL — `@/app/research/actions` does not exist.

- [ ] **Step 3: Create `src/app/research/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { requireCurrentUser } from "@/lib/auth/session";
import { abortResearchProject, developIdea } from "@/lib/jobs/research";

function requireFormString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value.trim();
}

export async function developIdeaAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const generatedIdeaId = requireFormString(formData, "generatedIdeaId");
  const project = await developIdea({ currentUserId: currentUser.id, generatedIdeaId });
  redirect(`/research/${project.id}` as Route);
}

export async function abortResearchProjectAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const researchProjectId = requireFormString(formData, "researchProjectId");
  await abortResearchProject({ currentUserId: currentUser.id, researchProjectId });
  redirect(`/research/${researchProjectId}` as Route);
}
```

- [ ] **Step 4: Run the action test to verify it passes**

```
npm test -- tests/research-actions.test.ts
```
Expected: PASS. (The `redirect` mock returns undefined, so the action resolves; in production `redirect` throws to interrupt — that's expected Next.js behavior.)

- [ ] **Step 5: Add the Develop button to `src/components/IdeaCard.tsx`** — import the action and render a form next to the existing dispatch link. Replace the existing dispatch block:

```tsx
      {canDispatch ? (
        <Link
          href={`/dispatch/${idea.id}`}
          className="mt-4 inline-flex rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white"
        >
          Dispatch viability check
        </Link>
      ) : null}
```

with:

```tsx
      {canDispatch ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/dispatch/${idea.id}`}
            className="inline-flex rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white"
          >
            Dispatch viability check
          </Link>
          <form action={developIdeaAction}>
            <input type="hidden" name="generatedIdeaId" value={idea.id} />
            <button
              type="submit"
              className="inline-flex rounded-md border border-rf-violetSoft bg-rf-surface px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-panel"
            >
              Develop this
            </button>
          </form>
        </div>
      ) : null}
```

Add the import at the top of `IdeaCard.tsx`:
```tsx
import { developIdeaAction } from "@/app/research/actions";
```

- [ ] **Step 6: Run the IdeaCard test to confirm no regression + typecheck**

```
npm test -- tests/paper-idea-group.test.tsx
npx tsc --noEmit --pretty false
```
Expected: PASS and exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/research/actions.ts src/components/IdeaCard.tsx tests/research-actions.test.ts
git commit -m "feat: add Develop this action and button"
```

---

## Task 7: Research list + detail pages

**Files:**
- Create: `src/app/research/page.tsx`
- Create: `src/app/research/[projectId]/page.tsx`
- Modify: `src/components/PageShell.tsx` (add a "Research" nav item)
- Test: `tests/research-pages.test.tsx` (create)

- [ ] **Step 1: Write the failing test** — create `tests/research-pages.test.tsx`:

```tsx
import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  getResearchProjectDetail: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: mocked.requireCurrentUser }));
vi.mock("@/lib/jobs/research", () => ({
  getResearchProjectDetail: mocked.getResearchProjectDetail,
  listResearchProjectsForUser: vi.fn()
}));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));

beforeEach(() => {
  mocked.requireCurrentUser.mockResolvedValue({ id: "user-1", name: "Researcher" });
});
afterEach(() => vi.clearAllMocks());

describe("research project detail page", () => {
  it("renders the plan and source-paper grounding when plan_ready", async () => {
    mocked.getResearchProjectDetail.mockResolvedValue({
      id: "proj-1",
      status: "plan_ready",
      currentStage: "plan",
      generatedIdea: { title: "Idea title", paper: { title: "Source paper", url: "https://arxiv.org/abs/2501.00001" } },
      planJob: { status: "completed" },
      plan: {
        planJson: JSON.stringify({
          relationToSourcePaper: "Extends the source paper.",
          hypotheses: ["H1"], experimentalDesign: "D", protocolSteps: ["S1"],
          datasets: [], baselines: [], metrics: ["m"], successCriteria: ["win"],
          computeEstimate: "1 GPU-day", risks: [],
          citations: [{ sourceType: "paper", url: "https://arxiv.org/abs/2501.00001", title: "Source paper", claim: "c", confidence: 0.9 }]
        })
      }
    });
    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    render(await ResearchProjectPage({ params: Promise.resolve({ projectId: "proj-1" }) }));

    expect(screen.getByText("Idea title")).toBeInTheDocument();
    expect(screen.getByText("Extends the source paper.")).toBeInTheDocument();
    // "Source paper" appears twice (source-paper link + its citation), so use getAllByText.
    expect(screen.getAllByText("Source paper").length).toBeGreaterThan(0);
  });

  it("calls notFound for a missing/forbidden project", async () => {
    mocked.getResearchProjectDetail.mockResolvedValue(null);
    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    await expect(ResearchProjectPage({ params: Promise.resolve({ projectId: "nope" }) })).rejects.toThrow("notFound");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
npm test -- tests/research-pages.test.tsx
```
Expected: FAIL — the page module does not exist.

- [ ] **Step 3: Create `src/app/research/[projectId]/page.tsx`**

```tsx
import React from "react";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/PageShell";
import { requireCurrentUser } from "@/lib/auth/session";
import { abortResearchProjectAction } from "@/app/research/actions";
import { getResearchProjectDetail } from "@/lib/jobs/research";
import { ResearchPlanSchema } from "@/lib/v2/schemas";

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-block rounded border border-rf-border bg-rf-surface px-2 py-0.5 text-xs font-bold uppercase tracking-[0.16em] text-rf-white">
      {status.replaceAll("_", " ")}
    </span>
  );
}

export default async function ResearchProjectPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const currentUser = await requireCurrentUser();
  const { projectId } = await params;
  const project = await getResearchProjectDetail({ currentUserId: currentUser.id, projectId });

  if (!project) notFound();

  const parsedPlan = project.plan ? ResearchPlanSchema.safeParse(JSON.parse(project.plan.planJson)) : null;
  const plan = parsedPlan && parsedPlan.success ? parsedPlan.data : null;

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="research"
    >
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-rf-muted">Research project</p>
            <h1 className="text-3xl font-semibold text-rf-white">{project.generatedIdea.title}</h1>
            <p className="mt-2 text-sm text-rf-muted">
              Stage {project.currentStage} · <StatusBadge status={project.status} />
            </p>
            <p className="mt-1 text-sm text-rf-muted">
              Source paper:{" "}
              <a className="text-rf-violetSoft" href={project.generatedIdea.paper.url} target="_blank" rel="noreferrer">
                {project.generatedIdea.paper.title}
              </a>
            </p>
          </div>
          {project.status === "running" ? (
            <form action={abortResearchProjectAction}>
              <input type="hidden" name="researchProjectId" value={project.id} />
              <button
                type="submit"
                className="rounded-md border border-rf-danger/50 bg-rf-surface px-4 py-2 text-sm font-semibold text-rf-danger"
              >
                Abort
              </button>
            </form>
          ) : null}
        </header>

        {plan ? (
          <section className="grid gap-4 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            <div>
              <h2 className="text-lg font-semibold text-rf-white">How this extends the source paper</h2>
              <p className="mt-1">{plan.relationToSourcePaper}</p>
            </div>
            <PlanList title="Hypotheses" items={plan.hypotheses} />
            <div>
              <h3 className="font-semibold text-rf-white">Experimental design</h3>
              <p className="mt-1">{plan.experimentalDesign}</p>
            </div>
            <PlanList title="Protocol" items={plan.protocolSteps} ordered />
            <PlanList title="Datasets" items={plan.datasets} />
            <PlanList title="Baselines" items={plan.baselines} />
            <PlanList title="Metrics" items={plan.metrics} />
            <PlanList title="Success criteria" items={plan.successCriteria} />
            <div>
              <h3 className="font-semibold text-rf-white">Compute estimate</h3>
              <p className="mt-1">{plan.computeEstimate}</p>
            </div>
            <PlanList title="Risks" items={plan.risks} />
            <div>
              <h3 className="font-semibold text-rf-white">Citations</h3>
              <ul className="mt-1 grid gap-1">
                {plan.citations.map((citation, index) => (
                  <li key={`${citation.title}-${index}`}>
                    {citation.url ? (
                      <a className="text-rf-violetSoft" href={citation.url} target="_blank" rel="noreferrer">
                        {citation.title}
                      </a>
                    ) : (
                      <span className="text-rf-white">{citation.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : (
          <section className="rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            {project.status === "failed"
              ? `Plan generation failed${project.planJob?.errorMessage ? `: ${project.planJob.errorMessage}` : "."}`
              : project.status === "aborted"
                ? "This project was aborted."
                : "The plan is being generated. Refresh shortly."}
          </section>
        )}
      </div>
    </PageShell>
  );
}

function PlanList({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
  if (items.length === 0) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <div>
      <h3 className="font-semibold text-rf-white">{title}</h3>
      <List className={`mt-1 grid gap-1 ${ordered ? "list-decimal pl-5" : ""}`}>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </List>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/research/page.tsx`**

```tsx
import React from "react";
import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { requireCurrentUser } from "@/lib/auth/session";
import { listResearchProjectsForUser } from "@/lib/jobs/research";

export default async function ResearchListPage() {
  const currentUser = await requireCurrentUser();
  const projects = await listResearchProjectsForUser(currentUser.id);

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="research"
    >
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-3xl font-semibold text-rf-white">Research projects</h1>
        <div className="mt-6 grid gap-2">
          {projects.length === 0 ? (
            <p className="text-sm text-rf-muted">
              No research projects yet. Use “Develop this” on an idea to start one.
            </p>
          ) : (
            projects.map((project) => (
              <Link
                key={project.id}
                href={`/research/${project.id}`}
                className="flex items-center justify-between rounded-md border border-rf-border bg-rf-panel px-4 py-3 text-sm text-rf-white hover:bg-rf-surface"
              >
                <span>{project.generatedIdea.title}</span>
                <span className="text-rf-muted">
                  {project.currentStage} · {project.status.replaceAll("_", " ")}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 5: Add a "Research" nav item** — read `src/components/PageShell.tsx`, then add a nav entry `{ key: "research", label: "Research", href: "/research" }` following the exact pattern of the existing inbox/profiles/workers entries, and add `"research"` to the `activeSection` union type. (Match whatever shape the existing nav array + props use.)

- [ ] **Step 6: Run the page test + full UI typecheck/build**

```
npm test -- tests/research-pages.test.tsx tests/app-shell.test.tsx
npx tsc --noEmit --pretty false
npm run build
```
Expected: PASS and exit 0. (`npm run build` takes 1-2 min; pre-existing Next/Auth warnings are fine.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/research/page.tsx" "src/app/research/[projectId]/page.tsx" src/components/PageShell.tsx tests/research-pages.test.tsx
git commit -m "feat: research project list and detail pages"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + types**

```
npm run lint
npx tsc --noEmit --pretty false
```
Expected: both exit 0.

- [ ] **Step 2: Full test suite with Postgres**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- --no-file-parallelism --testTimeout 60000
```
Expected: all pass except the one pre-existing intentional skip.

- [ ] **Step 3: Build**

```
npm run build
```
Expected: exit 0.

---

## Deployment Notes (post-merge, user-run)

- Apply the migration to Neon: `npm run db:deploy` (applies `20260625180000_autonomous_research_harness`).
- No worker reinstall needed — the existing local worker already loads `scripts/researchfinder-worker.ts` from the repo; after `git pull` it claims `research_plan` jobs automatically.
- Smoke test: open an idea → "Develop this" → confirm a project appears at `/research`, the worker logs `Claimed research_plan job … / Completed research_plan job …`, and the detail page shows a plan that cites the source paper.

## Implementation Notes

- Worker job priority stays `inbox_generation → novelty_scan → viability_check → research_plan`.
- The harness advance currently hardcodes `plan → plan_ready`; the next sub-project (literature/experiment stage) replaces that single line with "enqueue the next stage's job."
- Source-paper grounding (`assertCitesSourcePaper`) is mandatory for every stage that emits citations; reuse this pattern in later stages.
- Do not add `research_plan` to `V2_JOB_TYPES` (a domain test asserts its contents); the worker job-type unions list the literal explicitly, matching the existing style.
