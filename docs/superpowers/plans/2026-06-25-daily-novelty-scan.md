# Daily Novelty Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automatic morning novelty scan after AI inbox generation so each generated idea has evidence-backed novelty labels, source traces, and confidence before dispatch.

**Architecture:** Keep the hosted Next.js app as the control plane and Postgres as durable state. Add a `novelty_scan` worker job type that is queued after an inbox generation job completes; the local Windows Codex worker claims it, gathers arXiv/open scholarly/web evidence, asks Codex to synthesize calibrated novelty results, and uploads structured output. Persist scan records separately from source-paper citations so the inbox can show evidence without overwriting provenance.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/Postgres, Vitest, Zod, local Codex worker, arXiv API, optional no-key scholarly/web fetch adapters.

---

## Source Spec

Implement from: `docs/superpowers/specs/2026-06-25-daily-novelty-scan-design.md`

Key product decisions from the spec:

- The novelty scan runs automatically every morning after generated inbox ideas are created.
- The first implementation uses arXiv, open scholarly APIs, and general web evidence where available.
- The system must not force label variety.
- New labels are `likely_novel`, `unclear`, `crowded`, `near_duplicate`, and `not_checked`.
- Existing `needs_novelty_check` must remain readable for older records and viability outcomes.
- The dispatch prototype sprint is a separate feature and is not part of this plan.

## File Map

- Modify: `src/lib/v2/domain.ts`
  - Add calibrated novelty labels and worker job type.
- Modify: `src/lib/v2/schemas.ts`
  - Add novelty scan input/output schemas.
  - Allow generated inbox ideas to start as `not_checked`.
- Modify: `prisma/schema.prisma`
  - Add `NoveltyScanJob`, `NoveltyScan`, and `NoveltyEvidence`.
  - Add relations from `User`, `InboxGenerationJob`, and `GeneratedIdea`.
- Create: `prisma/migrations/20260625170000_daily_novelty_scan/migration.sql`
  - SQL migration for novelty scan tables and indexes.
- Create: `src/lib/jobs/novelty-scan.ts`
  - Server-side create, claim, complete, and persistence lifecycle.
- Modify: `src/lib/jobs/inbox-generation.ts`
  - Queue a novelty scan job after inbox generation succeeds.
  - Include latest novelty scan/evidence in inbox reads.
- Modify: `src/app/api/workers/claim/route.ts`
  - Claim `novelty_scan` jobs between inbox generation and viability checks.
- Modify: `src/app/api/workers/jobs/[jobId]/complete/route.ts`
  - Accept `novelty_scan` completion uploads.
- Create: `src/lib/novelty/query-builder.ts`
  - Build bounded search queries from ideas, papers, and profile context.
- Create: `src/worker/novelty-sources.ts`
  - Fetch arXiv/OpenAlex/Semantic Scholar/Crossref evidence where available.
- Modify: `scripts/researchfinder-worker.ts`
  - Run local novelty scan jobs, build Codex prompt, validate output, upload result.
- Modify: `src/worker/output-validation.ts`
  - Add novelty scan output parser.
- Modify: `src/app/inbox/[userId]/page.tsx`
  - Pass novelty scan result/evidence into idea cards.
- Modify: `src/components/IdeaCard.tsx`
  - Render calibrated novelty labels, confidence, overlap summary, and evidence.
- Modify or create tests:
  - `tests/v2-schemas.test.ts`
  - `tests/novelty-query-builder.test.ts`
  - `tests/novelty-source-adapters.test.ts`
  - `tests/novelty-scan-job.test.ts`
  - `tests/worker-claim-route.test.ts`
  - `tests/researchfinder-worker.test.ts`
  - `tests/generated-inbox-persistence.test.ts`
  - `tests/paper-idea-group.test.tsx`

---

## Task 1: Add Novelty Labels and Zod Schemas

**Files:**
- Modify: `src/lib/v2/domain.ts`
- Modify: `src/lib/v2/schemas.ts`
- Test: `tests/v2-schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add these tests inside `describe("v2 worker schemas", () => { ... })` in `tests/v2-schemas.test.ts`:

```ts
it("accepts calibrated novelty labels for generated inbox ideas", () => {
  for (const noveltyStatus of [
    "likely_novel",
    "unclear",
    "crowded",
    "near_duplicate",
    "not_checked"
  ]) {
    const result = GeneratedInboxSchema.parse(
      createInbox({
        papers: [
          createPaper({
            ideas: [
              createIdea({
                noveltyStatus
              })
            ]
          })
        ]
      })
    );

    expect(result.papers[0].ideas[0].noveltyStatus).toBe(noveltyStatus);
  }
});

it("accepts novelty scan worker output with evidence and query traces", async () => {
  const { NoveltyScanResultSchema } = await import("@/lib/v2/schemas");
  const result = NoveltyScanResultSchema.parse({
    jobId: "novelty-job-1",
    generatedForUserId: "user-1",
    inboxDate: "2026-06-25",
    scans: [
      {
        generatedIdeaId: "idea-1",
        status: "completed",
        label: "crowded",
        confidence: 0.78,
        summary: "Several adjacent benchmark-generation systems exist.",
        overlapExplanation:
          "The idea is adjacent to agentic synthetic-data systems but remains distinct if scoped to benchmark failure discovery.",
        queries: ["AutoBenchsmith benchmark generation", "agentic synthetic benchmark data"],
        adaptersAttempted: ["arxiv", "openalex", "semantic_scholar", "web"],
        adaptersFailed: [],
        evidence: [
          {
            sourceType: "scholarly",
            title: "Autodata: An agentic data scientist to create high quality synthetic data",
            url: "https://arxiv.org/abs/2606.25996",
            sourceId: "2606.25996",
            claim: "The source introduces agentic synthetic data creation.",
            overlapLevel: "adjacent",
            confidence: 0.86
          }
        ]
      }
    ]
  });

  expect(result.scans[0].label).toBe("crowded");
});

it("rejects novelty scan outputs without evidence unless label is not_checked", async () => {
  const { NoveltyScanResultSchema } = await import("@/lib/v2/schemas");

  expect(() =>
    NoveltyScanResultSchema.parse({
      jobId: "novelty-job-1",
      generatedForUserId: "user-1",
      inboxDate: "2026-06-25",
      scans: [
        {
          generatedIdeaId: "idea-1",
          status: "completed",
          label: "likely_novel",
          confidence: 0.7,
          summary: "No close matches found.",
          overlapExplanation: "No strong overlap was found.",
          queries: ["query"],
          adaptersAttempted: ["arxiv"],
          adaptersFailed: [],
          evidence: []
        }
      ]
    })
  ).toThrow(/evidence/);

  const unchecked = NoveltyScanResultSchema.parse({
    jobId: "novelty-job-1",
    generatedForUserId: "user-1",
    inboxDate: "2026-06-25",
    scans: [
      {
        generatedIdeaId: "idea-1",
        status: "failed",
        label: "not_checked",
        confidence: 0,
        summary: "No source adapters completed.",
        overlapExplanation: "Novelty could not be assessed.",
        queries: [],
        adaptersAttempted: ["arxiv"],
        adaptersFailed: ["arxiv"],
        evidence: []
      }
    ]
  });

  expect(unchecked.scans[0].label).toBe("not_checked");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/v2-schemas.test.ts --testNamePattern "novelty"
```

Expected: tests fail because `NoveltyScanResultSchema` is not exported and calibrated labels are not accepted.

- [ ] **Step 3: Update v2 domain constants**

In `src/lib/v2/domain.ts`, replace the novelty constants with:

```ts
export const CALIBRATED_NOVELTY_LABELS = [
  "likely_novel",
  "unclear",
  "crowded",
  "near_duplicate",
  "not_checked"
] as const;
export type CalibratedNoveltyLabel = (typeof CALIBRATED_NOVELTY_LABELS)[number];

export const LEGACY_NOVELTY_STATUSES = [
  "verified",
  "needs_novelty_check",
  "not_novel"
] as const;
export type LegacyNoveltyStatus = (typeof LEGACY_NOVELTY_STATUSES)[number];

export const NOVELTY_STATUSES = [
  ...LEGACY_NOVELTY_STATUSES,
  ...CALIBRATED_NOVELTY_LABELS
] as const;
export type NoveltyStatus = (typeof NOVELTY_STATUSES)[number];
```

Also update `V2_JOB_TYPES` to include the new worker job type:

```ts
export const V2_JOB_TYPES = ["inbox_generation", "novelty_scan", "viability_check"] as const;
```

- [ ] **Step 4: Add novelty scan schemas**

In `src/lib/v2/schemas.ts`, import `CALIBRATED_NOVELTY_LABELS` from `@/lib/v2/domain` and add these schemas after `InboxGenerationJobInputSchema`:

```ts
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
```

Add exports near the bottom:

```ts
export type NoveltyScanResult = z.infer<typeof NoveltyScanResultSchema>;
export type NoveltyScanJobInput = z.infer<typeof NoveltyScanJobInputSchema>;
```

- [ ] **Step 5: Update generated inbox prompt default label**

In `scripts/researchfinder-worker.ts`, update `buildGeneratedInboxJsonContract()` so generated ideas start as unchecked:

```ts
noveltyStatus: "not_checked",
```

Also update the nearby contract rule:

```ts
"- noveltyStatus should be \"not_checked\"; the separate morning novelty scan will calibrate it.",
```

- [ ] **Step 6: Run schema tests**

Run:

```powershell
npm test -- tests/v2-schemas.test.ts --testNamePattern "novelty"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/v2/domain.ts src/lib/v2/schemas.ts scripts/researchfinder-worker.ts tests/v2-schemas.test.ts
git commit -m "feat: add novelty scan schemas"
```

---

## Task 2: Add Novelty Persistence Models

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260625170000_daily_novelty_scan/migration.sql`
- Test: `tests/novelty-scan-job.test.ts`

- [ ] **Step 1: Write failing persistence test skeleton**

Create `tests/novelty-scan-job.test.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createNoveltyScanJobForInboxGeneration } from "@/lib/jobs/novelty-scan";
import { withPostgresTestDatabase } from "./helpers/postgres";

describe("novelty scan persistence", () => {
  it("creates one novelty scan job for a completed inbox generation job", async () => {
    await withPostgresTestDatabase(async (prisma: PrismaClient) => {
      const user = await prisma.user.create({
        data: {
          email: "researcher@example.com",
          profile: {
            create: {
              interestsJson: "[]",
              constraintsJson: "[]",
              preferredOutputsJson: "[]",
              rankingWeightsJson: "{}",
              arxivQuery: "cat:cs.AI",
              keywordsJson: "[\"agent evaluation\"]"
            }
          }
        }
      });
      const candidateBatch = await prisma.candidateBatch.create({
        data: {
          userId: user.id,
          inboxDate: "2026-06-25",
          source: "arxiv",
          query: "cat:cs.AI",
          status: "completed",
          completedAt: new Date()
        }
      });
      const inboxJob = await prisma.inboxGenerationJob.create({
        data: {
          userId: user.id,
          candidateBatchId: candidateBatch.id,
          inboxDate: "2026-06-25",
          status: "completed",
          inputJson: "{}",
          completedAt: new Date()
        }
      });

      const job = await createNoveltyScanJobForInboxGeneration({
        userId: user.id,
        inboxGenerationJobId: inboxJob.id,
        inboxDate: "2026-06-25"
      });
      const duplicate = await createNoveltyScanJobForInboxGeneration({
        userId: user.id,
        inboxGenerationJobId: inboxJob.id,
        inboxDate: "2026-06-25"
      });

      expect(duplicate.id).toBe(job.id);
      expect(job.status).toBe("queued");
    });
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/novelty-scan-job.test.ts --no-file-parallelism --testTimeout 60000
```

Expected: FAIL because `@/lib/jobs/novelty-scan` and Prisma models do not exist.

- [ ] **Step 3: Update Prisma schema**

In `prisma/schema.prisma`, add relations:

```prisma
model User {
  // existing fields...
  noveltyScanJobs InboxNoveltyScanJob[]
}

model InboxGenerationJob {
  // existing fields...
  noveltyScanJobs InboxNoveltyScanJob[]
}

model GeneratedIdea {
  // existing fields...
  noveltyScans NoveltyScan[]
}
```

Add new models after `GeneratedIdea`:

```prisma
model InboxNoveltyScanJob {
  id                   String    @id @default(cuid())
  userId               String
  inboxGenerationJobId String
  inboxDate            String
  status               String
  claimedByWorkerId    String?
  errorMessage         String?
  inputJson            String
  outputJson           String?
  startedAt            DateTime?
  completedAt          DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  user               User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  inboxGenerationJob InboxGenerationJob @relation(fields: [inboxGenerationJobId], references: [id], onDelete: Cascade)
  scans              NoveltyScan[]

  @@unique([userId, inboxGenerationJobId, inboxDate])
  @@index([userId, inboxDate, status])
  @@index([claimedByWorkerId, status])
}

model NoveltyScan {
  id                    String   @id @default(cuid())
  generatedIdeaId       String
  inboxNoveltyScanJobId String?
  status                String
  label                 String
  confidence            Float
  summary               String
  overlapExplanation    String
  queriesJson           String
  adaptersAttemptedJson String
  adaptersFailedJson    String
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  generatedIdea GeneratedIdea        @relation(fields: [generatedIdeaId], references: [id], onDelete: Cascade)
  job           InboxNoveltyScanJob? @relation(fields: [inboxNoveltyScanJobId], references: [id], onDelete: SetNull)
  evidence      NoveltyEvidence[]

  @@index([generatedIdeaId, createdAt])
  @@index([label])
}

model NoveltyEvidence {
  id           String   @id @default(cuid())
  scanId       String
  sourceType   String
  title        String
  url          String
  sourceId     String?
  claim        String
  overlapLevel String
  confidence   Float
  createdAt    DateTime @default(now())

  scan NoveltyScan @relation(fields: [scanId], references: [id], onDelete: Cascade)

  @@index([scanId])
  @@index([sourceType])
}
```

- [ ] **Step 4: Create SQL migration**

Create `prisma/migrations/20260625170000_daily_novelty_scan/migration.sql`:

```sql
CREATE TABLE "InboxNoveltyScanJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inboxGenerationJobId" TEXT NOT NULL,
    "inboxDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "claimedByWorkerId" TEXT,
    "errorMessage" TEXT,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxNoveltyScanJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoveltyScan" (
    "id" TEXT NOT NULL,
    "generatedIdeaId" TEXT NOT NULL,
    "inboxNoveltyScanJobId" TEXT,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "overlapExplanation" TEXT NOT NULL,
    "queriesJson" TEXT NOT NULL,
    "adaptersAttemptedJson" TEXT NOT NULL,
    "adaptersFailedJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoveltyScan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoveltyEvidence" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceId" TEXT,
    "claim" TEXT NOT NULL,
    "overlapLevel" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoveltyEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxNoveltyScanJob_userId_inboxGenerationJobId_inboxDate_key"
ON "InboxNoveltyScanJob"("userId", "inboxGenerationJobId", "inboxDate");

CREATE INDEX "InboxNoveltyScanJob_userId_inboxDate_status_idx"
ON "InboxNoveltyScanJob"("userId", "inboxDate", "status");

CREATE INDEX "InboxNoveltyScanJob_claimedByWorkerId_status_idx"
ON "InboxNoveltyScanJob"("claimedByWorkerId", "status");

CREATE INDEX "NoveltyScan_generatedIdeaId_createdAt_idx"
ON "NoveltyScan"("generatedIdeaId", "createdAt");

CREATE INDEX "NoveltyScan_label_idx"
ON "NoveltyScan"("label");

CREATE INDEX "NoveltyEvidence_scanId_idx"
ON "NoveltyEvidence"("scanId");

CREATE INDEX "NoveltyEvidence_sourceType_idx"
ON "NoveltyEvidence"("sourceType");

ALTER TABLE "InboxNoveltyScanJob"
ADD CONSTRAINT "InboxNoveltyScanJob_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboxNoveltyScanJob"
ADD CONSTRAINT "InboxNoveltyScanJob_inboxGenerationJobId_fkey"
FOREIGN KEY ("inboxGenerationJobId") REFERENCES "InboxGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoveltyScan"
ADD CONSTRAINT "NoveltyScan_generatedIdeaId_fkey"
FOREIGN KEY ("generatedIdeaId") REFERENCES "GeneratedIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoveltyScan"
ADD CONSTRAINT "NoveltyScan_inboxNoveltyScanJobId_fkey"
FOREIGN KEY ("inboxNoveltyScanJobId") REFERENCES "InboxNoveltyScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NoveltyEvidence"
ADD CONSTRAINT "NoveltyEvidence_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "NoveltyScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Generate Prisma client and validate schema**

Run:

```powershell
npm run db:generate
npx prisma validate
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/20260625170000_daily_novelty_scan/migration.sql tests/novelty-scan-job.test.ts
git commit -m "feat: add novelty scan persistence models"
```

---

## Task 3: Implement Novelty Scan Job Lifecycle

**Files:**
- Create: `src/lib/jobs/novelty-scan.ts`
- Modify: `tests/novelty-scan-job.test.ts`

- [ ] **Step 1: Extend failing lifecycle tests**

Add two tests to `tests/novelty-scan-job.test.ts`:

```ts
it("claims the oldest queued novelty scan job for the worker user", async () => {
  await withPostgresTestDatabase(async (prisma: PrismaClient) => {
    const { claimNextNoveltyScanJob } = await import("@/lib/jobs/novelty-scan");
    const user = await prisma.user.create({ data: { email: "worker@example.com" } });
    const otherUser = await prisma.user.create({ data: { email: "other@example.com" } });
    const inboxJob = await createCompletedInboxJob(prisma, user.id, "2026-06-25");
    const otherInboxJob = await createCompletedInboxJob(prisma, otherUser.id, "2026-06-25");
    const first = await prisma.inboxNoveltyScanJob.create({
      data: {
        userId: user.id,
        inboxGenerationJobId: inboxJob.id,
        inboxDate: "2026-06-25",
        status: "queued",
        inputJson: "{}",
        createdAt: new Date("2026-06-25T10:00:00.000Z")
      }
    });
    await prisma.inboxNoveltyScanJob.create({
      data: {
        userId: otherUser.id,
        inboxGenerationJobId: otherInboxJob.id,
        inboxDate: "2026-06-25",
        status: "queued",
        inputJson: "{}"
      }
    });

    const claimed = await claimNextNoveltyScanJob({
      userId: user.id,
      workerId: "worker-1"
    });

    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.claimedByWorkerId).toBe("worker-1");
  });
});

it("persists completed novelty scan output and updates generated idea labels", async () => {
  await withPostgresTestDatabase(async (prisma: PrismaClient) => {
    const { completeNoveltyScanJob } = await import("@/lib/jobs/novelty-scan");
    const user = await prisma.user.create({ data: { email: "worker@example.com" } });
    const inboxJob = await createCompletedInboxJob(prisma, user.id, "2026-06-25");
    const paper = await prisma.paper.create({
      data: {
        arxivId: "2606.00001",
        title: "Paper title",
        abstract: "Paper abstract",
        url: "https://arxiv.org/abs/2606.00001",
        publishedAt: new Date("2026-06-25T00:00:00.000Z"),
        arxivUpdatedAt: new Date("2026-06-25T00:00:00.000Z"),
        authorsJson: "[\"A. Researcher\"]",
        categoriesJson: "[\"cs.AI\"]"
      }
    });
    const idea = await prisma.generatedIdea.create({
      data: {
        userId: user.id,
        paperId: paper.id,
        inboxGenerationJobId: inboxJob.id,
        inboxDate: "2026-06-25",
        title: "AutoBenchsmith",
        summary: "Generate benchmark items.",
        expandedExplanation: "Expanded.",
        trajectory: "Trajectory.",
        noveltyStatus: "not_checked",
        relevanceScore: 0.9,
        significanceScore: 0.8,
        originalityScore: 0.7,
        feasibilityScore: 0.8,
        overallScore: 0.8,
        scoreExplanationsJson: "{}",
        risksJson: "[]",
        smallestSprint: "Build a pilot.",
        generatedBy: "codex"
      }
    });
    const job = await prisma.inboxNoveltyScanJob.create({
      data: {
        userId: user.id,
        inboxGenerationJobId: inboxJob.id,
        inboxDate: "2026-06-25",
        status: "running",
        claimedByWorkerId: "worker-1",
        inputJson: "{}"
      }
    });

    await completeNoveltyScanJob({
      jobId: job.id,
      workerId: "worker-1",
      output: {
        jobId: job.id,
        generatedForUserId: user.id,
        inboxDate: "2026-06-25",
        scans: [
          {
            generatedIdeaId: idea.id,
            status: "completed",
            label: "crowded",
            confidence: 0.82,
            summary: "Adjacent systems exist.",
            overlapExplanation: "The idea needs a sharper differentiator.",
            queries: ["AutoBenchsmith benchmark generation"],
            adaptersAttempted: ["arxiv"],
            adaptersFailed: [],
            evidence: [
              {
                sourceType: "arxiv",
                title: "Related paper",
                url: "https://arxiv.org/abs/2606.00002",
                sourceId: "2606.00002",
                claim: "Related benchmark generation work exists.",
                overlapLevel: "adjacent",
                confidence: 0.8
              }
            ]
          }
        ]
      }
    });

    const updatedIdea = await prisma.generatedIdea.findUniqueOrThrow({
      where: { id: idea.id },
      include: { noveltyScans: { include: { evidence: true } } }
    });

    expect(updatedIdea.noveltyStatus).toBe("crowded");
    expect(updatedIdea.noveltyScans[0].evidence[0].sourceId).toBe("2606.00002");
  });
});
```

Add this helper at the bottom of the test file:

```ts
async function createCompletedInboxJob(prisma: PrismaClient, userId: string, inboxDate: string) {
  const batch = await prisma.candidateBatch.create({
    data: {
      userId,
      inboxDate,
      source: `arxiv-${crypto.randomUUID()}`,
      query: "cat:cs.AI",
      status: "completed",
      completedAt: new Date()
    }
  });

  return prisma.inboxGenerationJob.create({
    data: {
      userId,
      candidateBatchId: batch.id,
      inboxDate,
      status: "completed",
      inputJson: "{}",
      completedAt: new Date()
    }
  });
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/novelty-scan-job.test.ts --no-file-parallelism --testTimeout 60000
```

Expected: FAIL because `src/lib/jobs/novelty-scan.ts` has no lifecycle implementation.

- [ ] **Step 3: Implement job lifecycle service**

Create `src/lib/jobs/novelty-scan.ts`:

```ts
import { prisma } from "@/lib/db";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";
import { NoveltyScanResultSchema } from "@/lib/v2/schemas";

const MAX_CLAIM_ATTEMPTS = 3;

export async function createNoveltyScanJobForInboxGeneration(input: {
  userId: string;
  inboxGenerationJobId: string;
  inboxDate: string;
}) {
  return prisma.inboxNoveltyScanJob.upsert({
    where: {
      userId_inboxGenerationJobId_inboxDate: {
        userId: input.userId,
        inboxGenerationJobId: input.inboxGenerationJobId,
        inboxDate: input.inboxDate
      }
    },
    update: {
      status: "queued",
      claimedByWorkerId: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      outputJson: null
    },
    create: {
      userId: input.userId,
      inboxGenerationJobId: input.inboxGenerationJobId,
      inboxDate: input.inboxDate,
      status: "queued",
      inputJson: JSON.stringify({
        inboxGenerationJobId: input.inboxGenerationJobId
      })
    }
  });
}

export async function claimNextNoveltyScanJob(input: { userId: string; workerId: string }) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const staleStartedBefore = staleRunningJobStartedBefore();
    const job = await prisma.inboxNoveltyScanJob.findFirst({
      where: {
        userId: input.userId,
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleStartedBefore } }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (!job) return null;

    const claim = await prisma.inboxNoveltyScanJob.updateMany({
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

    return prisma.inboxNoveltyScanJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        user: { include: { profile: true } },
        inboxGenerationJob: {
          include: {
            generatedIdeas: {
              include: {
                paper: true,
                citations: true
              },
              orderBy: [{ overallScore: "desc" }, { id: "asc" }]
            }
          }
        }
      }
    });
  }

  return null;
}

export async function completeNoveltyScanJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  const parsed = NoveltyScanResultSchema.parse(input.output);

  return prisma.$transaction(async (tx) => {
    const job = await tx.inboxNoveltyScanJob.findFirstOrThrow({
      where: {
        id: input.jobId,
        claimedByWorkerId: input.workerId,
        status: "running"
      },
      include: {
        inboxGenerationJob: {
          include: {
            generatedIdeas: { select: { id: true } }
          }
        }
      }
    });

    if (parsed.jobId !== job.id) {
      throw new Error("Novelty scan output does not match completed job id");
    }
    if (parsed.generatedForUserId !== job.userId || parsed.inboxDate !== job.inboxDate) {
      throw new Error("Novelty scan output does not match claimed job user/date");
    }

    const validIdeaIds = new Set(job.inboxGenerationJob.generatedIdeas.map((idea) => idea.id));
    for (const scan of parsed.scans) {
      if (!validIdeaIds.has(scan.generatedIdeaId)) {
        throw new Error("Novelty scan includes idea outside claimed inbox job");
      }
    }

    await tx.noveltyScan.deleteMany({
      where: {
        generatedIdeaId: { in: parsed.scans.map((scan) => scan.generatedIdeaId) },
        inboxNoveltyScanJobId: job.id
      }
    });

    for (const scanInput of parsed.scans) {
      const scan = await tx.noveltyScan.create({
        data: {
          generatedIdeaId: scanInput.generatedIdeaId,
          inboxNoveltyScanJobId: job.id,
          status: scanInput.status,
          label: scanInput.label,
          confidence: scanInput.confidence,
          summary: scanInput.summary,
          overlapExplanation: scanInput.overlapExplanation,
          queriesJson: JSON.stringify(scanInput.queries),
          adaptersAttemptedJson: JSON.stringify(scanInput.adaptersAttempted),
          adaptersFailedJson: JSON.stringify(scanInput.adaptersFailed)
        }
      });

      await tx.noveltyEvidence.createMany({
        data: scanInput.evidence.map((evidence) => ({
          scanId: scan.id,
          sourceType: evidence.sourceType,
          title: evidence.title,
          url: evidence.url,
          sourceId: evidence.sourceId,
          claim: evidence.claim,
          overlapLevel: evidence.overlapLevel,
          confidence: evidence.confidence
        }))
      });

      await tx.generatedIdea.update({
        where: { id: scanInput.generatedIdeaId },
        data: { noveltyStatus: scanInput.label }
      });
    }

    await tx.inboxNoveltyScanJob.updateMany({
      where: {
        id: job.id,
        claimedByWorkerId: input.workerId,
        status: "running"
      },
      data: {
        status: "completed",
        outputJson: JSON.stringify(parsed),
        completedAt: new Date()
      }
    });
  });
}
```

- [ ] **Step 4: Run lifecycle tests**

Run:

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/novelty-scan-job.test.ts --no-file-parallelism --testTimeout 60000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/jobs/novelty-scan.ts tests/novelty-scan-job.test.ts
git commit -m "feat: add novelty scan job lifecycle"
```

---

## Task 4: Build Novelty Query and Source Adapters

**Files:**
- Create: `src/lib/novelty/query-builder.ts`
- Create: `src/worker/novelty-sources.ts`
- Modify: `src/lib/arxiv/client.ts`
- Test: `tests/novelty-query-builder.test.ts`
- Test: `tests/novelty-source-adapters.test.ts`

References used for adapter shape:
- Semantic Scholar Academic Graph API: `https://www.semanticscholar.org/product/api`
- OpenAlex API base URL and works/search docs: `https://developers.openalex.org/api-reference/introduction`
- Crossref REST API docs: `https://www.crossref.org/documentation/retrieve-metadata/rest-api/`

- [ ] **Step 1: Write query builder tests**

Create `tests/novelty-query-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildNoveltyQueries } from "@/lib/novelty/query-builder";

describe("novelty query builder", () => {
  it("builds bounded exact and broad queries from idea and source paper context", () => {
    const queries = buildNoveltyQueries({
      ideaTitle: "AutoBenchsmith for Agent Benchmark Item Generation",
      ideaSummary: "Generate benchmark items for agent failure discovery.",
      paperTitle: "Autodata: An agentic data scientist to create high quality synthetic data",
      paperAbstract: "We study agentic synthetic data creation.",
      keywords: ["agent evaluation", "benchmark generation"]
    });

    expect(queries).toEqual([
      "\"AutoBenchsmith\" \"benchmark\"",
      "\"Agent Benchmark Item Generation\"",
      "\"benchmark generation\" \"agent evaluation\"",
      "\"agentic synthetic data\" \"benchmark\"",
      "agent benchmark generation failure discovery"
    ]);
  });

  it("deduplicates and caps queries", () => {
    const queries = buildNoveltyQueries({
      ideaTitle: "OrderRobustEval: Shuffle Invariance Tests",
      ideaSummary: "Shuffle invariance tests for benchmark robustness.",
      paperTitle: "Shuffle Invariance Tests",
      paperAbstract: "Shuffle invariance tests.",
      keywords: ["benchmark robustness", "benchmark robustness"],
      maxQueries: 3
    });

    expect(queries).toHaveLength(3);
    expect(new Set(queries).size).toBe(3);
  });
});
```

- [ ] **Step 2: Implement query builder**

Create `src/lib/novelty/query-builder.ts`:

```ts
type NoveltyQueryInput = {
  ideaTitle: string;
  ideaSummary: string;
  paperTitle: string;
  paperAbstract: string;
  keywords: string[];
  maxQueries?: number;
};

const DEFAULT_MAX_QUERIES = 5;

export function buildNoveltyQueries(input: NoveltyQueryInput) {
  const titleMain = input.ideaTitle.split(":")[0]?.trim() || input.ideaTitle;
  const titleRemainder = input.ideaTitle.includes(":")
    ? input.ideaTitle.split(":").slice(1).join(":").trim()
    : input.ideaTitle;
  const keywordPair = input.keywords.slice(0, 2);
  const paperPhrase = extractPhrase(input.paperTitle, input.paperAbstract);
  const summaryTerms = extractUnquotedTerms(input.ideaSummary);

  const candidates = [
    `"${firstWords(titleMain, 4)}" "benchmark"`,
    `"${firstWords(titleRemainder, 5)}"`,
    keywordPair.length >= 2 ? `"${keywordPair[1]}" "${keywordPair[0]}"` : "",
    paperPhrase ? `"${paperPhrase}" "benchmark"` : "",
    summaryTerms
  ];

  return dedupe(
    candidates
      .map((query) => query.replace(/\s+/g, " ").trim())
      .filter((query) => query.length > 3)
  ).slice(0, input.maxQueries ?? DEFAULT_MAX_QUERIES);
}

function firstWords(value: string, count: number) {
  return value
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function extractPhrase(title: string, abstract: string) {
  const combined = `${title} ${abstract}`.toLowerCase();
  if (combined.includes("agentic synthetic data")) return "agentic synthetic data";
  if (combined.includes("shuffle invariance")) return "shuffle invariance";
  if (combined.includes("tool use")) return "tool use";
  if (combined.includes("benchmark")) return "benchmark";
  return firstWords(title, 4).toLowerCase();
}

function extractUnquotedTerms(value: string) {
  const words = value
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 6);

  return words.join(" ").toLowerCase();
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}
```

- [ ] **Step 3: Add arXiv sort support**

Modify `src/lib/arxiv/client.ts`:

```ts
export type FetchArxivPapersOptions = {
  sortBy?: "relevance" | "lastUpdatedDate" | "submittedDate";
  sortOrder?: "ascending" | "descending";
};

export async function fetchArxivPapers(
  query: string,
  maxResults: number,
  options: FetchArxivPapersOptions = {}
): Promise<ArxivPaperInput[]> {
  const params = new URLSearchParams({
    search_query: query,
    start: "0",
    max_results: String(maxResults),
    sortBy: options.sortBy ?? "submittedDate",
    sortOrder: options.sortOrder ?? "descending"
  });
  // keep existing fetch and parse logic
}
```

- [ ] **Step 4: Write source adapter tests**

Create `tests/novelty-source-adapters.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { gatherNoveltySourceEvidence } from "@/worker/novelty-sources";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("novelty source adapters", () => {
  it("returns partial evidence and records adapter failures", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          `<?xml version="1.0"?><feed><entry><id>https://arxiv.org/abs/2606.00002</id><title>Related benchmark generation</title><summary>Related abstract</summary><published>2026-06-24T00:00:00Z</published><updated>2026-06-24T00:00:00Z</updated><author><name>A. Author</name></author><category term="cs.AI"/></entry></feed>`,
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    const result = await gatherNoveltySourceEvidence({
      queries: ["benchmark generation"],
      maxResultsPerQuery: 1
    });

    expect(result.adaptersAttempted).toContain("arxiv");
    expect(result.adaptersFailed).toContain("openalex");
    expect(result.evidence[0]).toMatchObject({
      sourceType: "arxiv",
      title: "Related benchmark generation",
      sourceId: "2606.00002"
    });
  });
});
```

- [ ] **Step 5: Implement source adapters**

Create `src/worker/novelty-sources.ts`:

```ts
import { fetchArxivPapers } from "@/lib/arxiv/client";

type GatherNoveltySourceEvidenceInput = {
  queries: string[];
  maxResultsPerQuery?: number;
};

type NoveltySourceEvidence = {
  sourceType: "arxiv" | "scholarly" | "web" | "github";
  title: string;
  url: string;
  sourceId?: string;
  claim: string;
  overlapLevel: "exact" | "close" | "adjacent" | "weak";
  confidence: number;
};

export async function gatherNoveltySourceEvidence(input: GatherNoveltySourceEvidenceInput) {
  const adaptersAttempted = ["arxiv", "openalex", "semantic_scholar"];
  const adaptersFailed: string[] = [];
  const evidence: NoveltySourceEvidence[] = [];
  const maxResults = input.maxResultsPerQuery ?? 3;

  for (const query of input.queries) {
    try {
      const papers = await fetchArxivPapers(query, maxResults, { sortBy: "relevance" });
      evidence.push(
        ...papers.map((paper) => ({
          sourceType: "arxiv" as const,
          title: paper.title,
          url: paper.url,
          sourceId: paper.arxivId,
          claim: paper.abstract.slice(0, 500),
          overlapLevel: "adjacent" as const,
          confidence: 0.6
        }))
      );
    } catch {
      adaptersFailed.push("arxiv");
    }

    try {
      evidence.push(...(await fetchOpenAlexEvidence(query, maxResults)));
    } catch {
      adaptersFailed.push("openalex");
    }

    try {
      evidence.push(...(await fetchSemanticScholarEvidence(query, maxResults)));
    } catch {
      adaptersFailed.push("semantic_scholar");
    }
  }

  return {
    adaptersAttempted,
    adaptersFailed: Array.from(new Set(adaptersFailed)),
    evidence: dedupeEvidence(evidence)
  };
}

async function fetchOpenAlexEvidence(query: string, maxResults: number): Promise<NoveltySourceEvidence[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(maxResults));
  const response = await fetch(url, {
    headers: { "User-Agent": "research-finder/0.1 (mailto:researchfinder@example.com)" }
  });
  if (!response.ok) throw new Error(`OpenAlex failed with ${response.status}`);
  const body = (await response.json()) as { results?: Array<Record<string, unknown>> };

  return (body.results ?? []).map((work) => ({
    sourceType: "scholarly",
    title: readString(work.title, "Untitled OpenAlex work"),
    url: readString(work.doi, readString(work.id, "")),
    sourceId: readString(work.id, undefined),
    claim: readString(work.title, "OpenAlex matched this work."),
    overlapLevel: "adjacent",
    confidence: 0.55
  }));
}

async function fetchSemanticScholarEvidence(
  query: string,
  maxResults: number
): Promise<NoveltySourceEvidence[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(maxResults));
  url.searchParams.set("fields", "title,url,abstract,paperId");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Semantic Scholar failed with ${response.status}`);
  const body = (await response.json()) as { data?: Array<Record<string, unknown>> };

  return (body.data ?? []).map((paper) => ({
    sourceType: "scholarly",
    title: readString(paper.title, "Untitled Semantic Scholar paper"),
    url: readString(paper.url, ""),
    sourceId: readString(paper.paperId, undefined),
    claim: readString(paper.abstract, readString(paper.title, "Semantic Scholar matched this paper.")),
    overlapLevel: "adjacent",
    confidence: 0.55
  }));
}

function dedupeEvidence(evidence: NoveltySourceEvidence[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.sourceType}:${item.url || item.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readString(value: unknown, fallback: string): string;
function readString(value: unknown, fallback: undefined): string | undefined;
function readString(value: unknown, fallback: string | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
```

- [ ] **Step 6: Run adapter tests**

Run:

```powershell
npm test -- tests/novelty-query-builder.test.ts tests/novelty-source-adapters.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/novelty/query-builder.ts src/worker/novelty-sources.ts src/lib/arxiv/client.ts tests/novelty-query-builder.test.ts tests/novelty-source-adapters.test.ts
git commit -m "feat: add novelty source adapters"
```

---

## Task 5: Add Worker Claim and Completion Routes for Novelty Jobs

**Files:**
- Modify: `src/app/api/workers/claim/route.ts`
- Modify: `src/app/api/workers/jobs/[jobId]/complete/route.ts`
- Test: `tests/worker-claim-route.test.ts`
- Test: `tests/v2-viability-worker.test.ts`

- [ ] **Step 1: Write claim route test for novelty job ordering**

Add to `tests/worker-claim-route.test.ts`:

```ts
it("claims novelty scan jobs before viability jobs after inbox jobs are exhausted", async () => {
  mocked.readBearerToken.mockReturnValue("worker-token");
  mocked.findAllowedWorkerByToken.mockResolvedValue({
    id: "worker-1",
    userId: "user-1",
    tokenHash: "stored-hash",
    user: { email: "worker@example.com" }
  });
  mocked.claimNextInboxGenerationJob.mockResolvedValue(null);
  mocked.claimNextNoveltyScanJob.mockResolvedValue({
    id: "novelty-job-1",
    userId: "user-1",
    inboxDate: "2026-06-25",
    status: "running",
    claimedByWorkerId: "worker-1",
    user: {
      profile: {
        fieldPresetKey: "ai_ml",
        keywordsJson: "[\"agent evaluation\"]",
        constraintsJson: "[]",
        preferredOutputsJson: "[\"benchmark\"]",
        allowRelatedWorkSearch: true
      }
    },
    inboxGenerationJob: {
      generatedIdeas: [
        {
          id: "idea-1",
          title: "AutoBenchsmith",
          summary: "Generate benchmark items.",
          expandedExplanation: "Expanded.",
          trajectory: "Trajectory.",
          smallestSprint: "Build a pilot.",
          paper: {
            id: "paper-1",
            arxivId: "2606.00001",
            title: "Paper title",
            abstract: "Paper abstract",
            url: "https://arxiv.org/abs/2606.00001",
            authorsJson: "[\"A. Researcher\"]",
            categoriesJson: "[\"cs.AI\"]",
            publishedAt: new Date("2026-06-25T00:00:00.000Z")
          },
          citations: []
        }
      ]
    }
  });

  const { POST } = await import("@/app/api/workers/claim/route");
  const response = await POST(new Request("https://example.com/api/workers/claim"));
  const body = await response.json();

  expect(body.job.type).toBe("novelty_scan");
  expect(body.job.input.ideas[0].id).toBe("idea-1");
});
```

Update the route mocks in the test file to include `claimNextNoveltyScanJob`.

- [ ] **Step 2: Update claim route implementation**

In `src/app/api/workers/claim/route.ts`:

```ts
import { claimNextNoveltyScanJob } from "@/lib/jobs/novelty-scan";
import {
  type NoveltyScanJobInput,
  NoveltyScanJobInputSchema
} from "@/lib/v2/schemas";
```

After inbox generation claim returns null and before viability claim:

```ts
const noveltyJob = await claimNextNoveltyScanJob({
  userId: worker.userId,
  workerId: worker.id
});

if (noveltyJob) {
  try {
    const input = buildNoveltyScanJobInput(noveltyJob);
    return NextResponse.json({
      job: {
        type: "novelty_scan",
        id: noveltyJob.id,
        input
      }
    });
  } catch (error) {
    await prisma.inboxNoveltyScanJob.update({
      where: { id: noveltyJob.id },
      data: {
        status: "failed",
        errorMessage: formatErrorMessage(error),
        completedAt: new Date()
      }
    });

    return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
  }
}
```

Add helper:

```ts
type ClaimedNoveltyScanJob = NonNullable<Awaited<ReturnType<typeof claimNextNoveltyScanJob>>>;

function buildNoveltyScanJobInput(job: ClaimedNoveltyScanJob): NoveltyScanJobInput {
  if (!job.user.profile) {
    throw new Error("Worker user has no research profile");
  }

  return NoveltyScanJobInputSchema.parse({
    jobId: job.id,
    userId: job.userId,
    inboxDate: job.inboxDate,
    profile: {
      fieldPreset: job.user.profile.fieldPresetKey,
      keywords: parseJsonArray(job.user.profile.keywordsJson, "keywordsJson"),
      constraints: parseJsonArray(job.user.profile.constraintsJson, "constraintsJson"),
      preferredOutputs: parseJsonArray(
        job.user.profile.preferredOutputsJson,
        "preferredOutputsJson"
      ),
      allowRelatedWorkSearch: job.user.profile.allowRelatedWorkSearch
    },
    ideas: job.inboxGenerationJob.generatedIdeas.map((idea) => ({
      id: idea.id,
      title: idea.title,
      summary: idea.summary,
      expandedExplanation: idea.expandedExplanation,
      trajectory: idea.trajectory,
      smallestSprint: idea.smallestSprint,
      paper: {
        id: idea.paper.id,
        arxivId: idea.paper.arxivId,
        title: idea.paper.title,
        abstract: idea.paper.abstract,
        url: idea.paper.url,
        authors: parseJsonArray(idea.paper.authorsJson, "authorsJson"),
        categories: parseJsonArray(idea.paper.categoriesJson, "categoriesJson"),
        publishedAt: idea.paper.publishedAt.toISOString()
      }
    }))
  });
}
```

- [ ] **Step 3: Update completion route**

In `src/app/api/workers/jobs/[jobId]/complete/route.ts`, import:

```ts
import { completeNoveltyScanJob } from "@/lib/jobs/novelty-scan";
```

Update type:

```ts
type WorkerJobType = "inbox_generation" | "novelty_scan" | "viability_check";
```

In the completion branch:

```ts
if (jobType === "inbox_generation") {
  await completeInboxGenerationJob({ jobId, workerId: worker.id, output: body.output });
} else if (jobType === "novelty_scan") {
  await completeNoveltyScanJob({ jobId, workerId: worker.id, output: body.output });
} else {
  await completeV2ViabilityJob({ jobId, workerId: worker.id, output: body.output });
}
```

Update `markWorkerJobFailed()` with a novelty branch:

```ts
if (input.jobType === "novelty_scan") {
  await prisma.inboxNoveltyScanJob.updateMany({ where, data });
  return;
}
```

Update `resolveJobType()`:

```ts
const requestedType =
  input.requestedType === "inbox_generation" ||
  input.requestedType === "novelty_scan" ||
  input.requestedType === "viability_check"
    ? input.requestedType
    : null;

const noveltyJob = await prisma.inboxNoveltyScanJob.findFirst({
  where: {
    id: input.jobId,
    claimedByWorkerId: input.workerId,
    status: "running"
  },
  select: { id: true }
});

if (noveltyJob) {
  return requestedType && requestedType !== "novelty_scan" ? null : "novelty_scan";
}
```

- [ ] **Step 4: Run route tests**

Run:

```powershell
npm test -- tests/worker-claim-route.test.ts tests/v2-viability-worker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/api/workers/claim/route.ts src/app/api/workers/jobs/[jobId]/complete/route.ts tests/worker-claim-route.test.ts tests/v2-viability-worker.test.ts
git commit -m "feat: route novelty scan worker jobs"
```

---

## Task 6: Implement Local Worker Novelty Scan Execution

**Files:**
- Modify: `scripts/researchfinder-worker.ts`
- Modify: `src/worker/output-validation.ts`
- Test: `tests/researchfinder-worker.test.ts`
- Test: `tests/worker-output-validation.test.ts`

- [ ] **Step 1: Write worker output validation test**

Add to `tests/worker-output-validation.test.ts`:

```ts
it("parses novelty scan output", () => {
  const output = parseNoveltyScanOutput(
    JSON.stringify({
      jobId: "novelty-job-1",
      generatedForUserId: "user-1",
      inboxDate: "2026-06-25",
      scans: [
        {
          generatedIdeaId: "idea-1",
          status: "completed",
          label: "likely_novel",
          confidence: 0.72,
          summary: "No close duplicates were found.",
          overlapExplanation: "Related systems exist, but none target this evaluation gap.",
          queries: ["query"],
          adaptersAttempted: ["arxiv"],
          adaptersFailed: [],
          evidence: [
            {
              sourceType: "arxiv",
              title: "Adjacent source",
              url: "https://arxiv.org/abs/2606.00002",
              sourceId: "2606.00002",
              claim: "Adjacent work exists.",
              overlapLevel: "adjacent",
              confidence: 0.6
            }
          ]
        }
      ]
    })
  );

  expect(output.scans[0].label).toBe("likely_novel");
});
```

- [ ] **Step 2: Add parser**

In `src/worker/output-validation.ts`:

```ts
import {
  GeneratedInboxSchema,
  NoveltyScanResultSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";

export function parseNoveltyScanOutput(raw: string) {
  return NoveltyScanResultSchema.parse(JSON.parse(raw));
}
```

- [ ] **Step 3: Write local worker test**

Add to `tests/researchfinder-worker.test.ts`:

```ts
it("completes claimed novelty scan jobs with source evidence and validated Codex output", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      createJsonResponse({
        job: {
          type: "novelty_scan",
          id: "novelty-job-1",
          input: {
            jobId: "novelty-job-1",
            userId: "user-1",
            inboxDate: "2026-06-25",
            profile: {
              fieldPreset: "ai_ml",
              keywords: ["agent evaluation"],
              constraints: [],
              preferredOutputs: ["benchmark"],
              allowRelatedWorkSearch: true
            },
            ideas: [
              {
                id: "idea-1",
                title: "AutoBenchsmith",
                summary: "Generate benchmark items.",
                expandedExplanation: "Expanded.",
                trajectory: "Trajectory.",
                smallestSprint: "Build a pilot.",
                paper: {
                  id: "paper-1",
                  arxivId: "2606.00001",
                  title: "Paper title",
                  abstract: "Paper abstract",
                  url: "https://arxiv.org/abs/2606.00001",
                  authors: ["A. Researcher"],
                  categories: ["cs.AI"],
                  publishedAt: "2026-06-25T00:00:00.000Z"
                }
              }
            ]
          }
        }
      })
    )
    .mockResolvedValueOnce(createJsonResponse({ ok: true }));
  const runCodex = vi.fn().mockResolvedValue(
    JSON.stringify({
      jobId: "novelty-job-1",
      generatedForUserId: "user-1",
      inboxDate: "2026-06-25",
      scans: [
        {
          generatedIdeaId: "idea-1",
          status: "completed",
          label: "unclear",
          confidence: 0.64,
          summary: "Adjacent evidence exists.",
          overlapExplanation: "No exact duplicate was found in the bounded scan.",
          queries: ["AutoBenchsmith benchmark"],
          adaptersAttempted: ["arxiv"],
          adaptersFailed: [],
          evidence: [
            {
              sourceType: "arxiv",
              title: "Adjacent source",
              url: "https://arxiv.org/abs/2606.00002",
              sourceId: "2606.00002",
              claim: "Adjacent benchmark generation work exists.",
              overlapLevel: "adjacent",
              confidence: 0.61
            }
          ]
        }
      ]
    })
  );
  const gatherNoveltySourceEvidence = vi.fn().mockResolvedValue({
    adaptersAttempted: ["arxiv"],
    adaptersFailed: [],
    evidence: [
      {
        sourceType: "arxiv",
        title: "Adjacent source",
        url: "https://arxiv.org/abs/2606.00002",
        sourceId: "2606.00002",
        claim: "Adjacent work exists.",
        overlapLevel: "adjacent",
        confidence: 0.61
      }
    ]
  });
  globalThis.fetch = fetchMock;
  vi.spyOn(console, "log").mockImplementation(() => {});

  const processed = await runResearchFinderWorkerOnce(
    {
      appUrl: "https://research.example.com",
      workerToken: "worker-token"
    },
    { runCodex, gatherNoveltySourceEvidence }
  );

  expect(processed).toBe(true);
  const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  expect(completionBody.type).toBe("novelty_scan");
  expect(completionBody.output.scans[0].label).toBe("unclear");
});
```

Extend `WorkerRunOptions` in `scripts/researchfinder-worker.ts` to allow injected source gathering:

```ts
import { gatherNoveltySourceEvidence as defaultGatherNoveltySourceEvidence } from "@/worker/novelty-sources";

type WorkerRunOptions = {
  runCodex?: typeof defaultRunCodex;
  gatherNoveltySourceEvidence?: typeof defaultGatherNoveltySourceEvidence;
  sleep?: Sleep;
  pollMs?: number;
  maxIterations?: number;
  shouldStop?: () => boolean;
};
```

- [ ] **Step 4: Update worker type handling**

In `scripts/researchfinder-worker.ts`, update `parseClaimPayload()`:

```ts
if (
  job.type !== "inbox_generation" &&
  job.type !== "novelty_scan" &&
  job.type !== "viability_check"
) {
  throw new FatalWorkerError(`Unsupported worker job type: ${String(job.type)}`);
}
```

Add branch in `runResearchFinderWorkerOnce()` before viability:

```ts
if (payload.job.type === "novelty_scan") {
  const result = await runNoveltyScanJob(payload.job, config, options);
  await completeWorkerJob(config, payload.job, result.output);
  if (result.validationError) throw new ProcessedWorkerError(result.validationError);
  console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
  return true;
}
```

Update completion type strings to include `novelty_scan`.

- [ ] **Step 5: Implement novelty scan runner**

Add imports:

```ts
import { buildNoveltyQueries } from "@/lib/novelty/query-builder";
import { NoveltyScanJobInputSchema, type NoveltyScanJobInput } from "@/lib/v2/schemas";
import { gatherNoveltySourceEvidence as defaultGatherNoveltySourceEvidence } from "@/worker/novelty-sources";
import { parseInboxGenerationOutput, parseNoveltyScanOutput, parseViabilityOutput } from "@/worker/output-validation";
```

Add functions:

```ts
async function runNoveltyScanJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseNoveltyScanJobInput(job.input);
  const evidenceBundle = await gatherEvidenceForNoveltyInput(input, options);
  const prompt = await writeNoveltyScanPrompt(job.id, input, evidenceBundle);

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
      return { output: parseNoveltyScanOutput(rawOutput) };
    } catch (error) {
      return {
        output: parseRawCodexOutputForCompletion(rawOutput),
        validationError: error
      };
    }
  } finally {
    await rm(prompt.dir, { force: true, recursive: true });
  }
}

function parseNoveltyScanJobInput(value: unknown) {
  try {
    return NoveltyScanJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(
      `Novelty scan job input failed validation: ${formatErrorMessage(error)}`
    );
  }
}

async function gatherEvidenceForNoveltyInput(
  input: NoveltyScanJobInput,
  options: WorkerRunOptions
) {
  const gather = options.gatherNoveltySourceEvidence ?? defaultGatherNoveltySourceEvidence;
  const evidenceByIdeaId: Record<string, unknown> = {};

  for (const idea of input.ideas) {
    const queries = buildNoveltyQueries({
      ideaTitle: idea.title,
      ideaSummary: idea.summary,
      paperTitle: idea.paper.title,
      paperAbstract: idea.paper.abstract,
      keywords: input.profile.keywords
    });

    evidenceByIdeaId[idea.id] = {
      queries,
      ...(input.profile.allowRelatedWorkSearch
        ? await gather({ queries, maxResultsPerQuery: 3 })
        : {
            adaptersAttempted: [],
            adaptersFailed: [],
            evidence: []
          })
    };
  }

  return evidenceByIdeaId;
}

async function writeNoveltyScanPrompt(
  jobId: string,
  input: NoveltyScanJobInput,
  evidenceBundle: Record<string, unknown>
) {
  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-novelty-"));
  const promptFile = join(promptDir, `${jobId}.prompt.md`);

  await writeFile(promptFile, buildNoveltyScanPrompt(jobId, input, evidenceBundle), "utf8");
  return { dir: promptDir, file: promptFile };
}

function buildNoveltyScanPrompt(
  jobId: string,
  input: NoveltyScanJobInput,
  evidenceBundle: Record<string, unknown>
) {
  return [
    "You are running a bounded ResearchFinder daily novelty scan.",
    "Return only valid JSON. Do not wrap the result in Markdown.",
    "Do not force label variety. Use the evidence.",
    "Use likely_novel only when the idea has a concrete differentiator and no close match.",
    "Use unclear when evidence is insufficient or adjacent overlap is unresolved.",
    "Use crowded when many adjacent sources exist.",
    "Use near_duplicate when a close paper, repo, benchmark, or project already does the same thing.",
    "Use not_checked only if evidence collection did not run.",
    `The JSON jobId must be exactly ${JSON.stringify(jobId)}.`,
    "",
    "Claimed job input:",
    JSON.stringify(input, null, 2),
    "",
    "Source evidence gathered before synthesis:",
    JSON.stringify(evidenceBundle, null, 2)
  ].join("\n");
}
```

- [ ] **Step 6: Run worker tests**

Run:

```powershell
npm test -- tests/worker-output-validation.test.ts tests/researchfinder-worker.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add scripts/researchfinder-worker.ts src/worker/output-validation.ts tests/researchfinder-worker.test.ts tests/worker-output-validation.test.ts
git commit -m "feat: run novelty scans in local worker"
```

---

## Task 7: Queue Novelty Scan Jobs After Inbox Generation

**Files:**
- Modify: `src/lib/jobs/inbox-generation.ts`
- Test: `tests/generated-inbox-persistence.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/generated-inbox-persistence.test.ts`:

```ts
it("queues a novelty scan job after generated inbox persistence succeeds", async () => {
  await withPostgresTestDatabase(async (prisma) => {
    const { completeInboxGenerationJob } = await import("@/lib/jobs/inbox-generation");
    const setup = await createRunningInboxGenerationJob(prisma, {
      userId: "user-1",
      inboxDate: "2026-06-23",
      candidateIndexes: [1]
    });

    await completeInboxGenerationJob({
      jobId: setup.job.id,
      workerId: "worker-1",
      output: createGeneratedInbox({
        generatedForUserId: setup.user.id,
        inboxDate: setup.job.inboxDate
      })
    });

    const noveltyJob = await prisma.inboxNoveltyScanJob.findFirst({
      where: {
        userId: setup.user.id,
        inboxGenerationJobId: setup.job.id,
        inboxDate: setup.job.inboxDate
      }
    });

    expect(noveltyJob?.status).toBe("queued");
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/generated-inbox-persistence.test.ts --no-file-parallelism --testTimeout 60000
```

Expected: FAIL because no novelty scan job is created.

- [ ] **Step 3: Queue scan job after inbox persistence**

In `src/lib/jobs/inbox-generation.ts`, import:

```ts
import { createNoveltyScanJobForInboxGeneration } from "@/lib/jobs/novelty-scan";
```

After the transaction in `completeInboxGenerationJob()` succeeds and returns the completed job, create the novelty scan job:

```ts
const completedJob = await prisma.$transaction(async (tx) => {
  // keep existing transaction body, but return final inbox job
});

await createNoveltyScanJobForInboxGeneration({
  userId: completedJob.userId,
  inboxGenerationJobId: completedJob.id,
  inboxDate: completedJob.inboxDate
});

return completedJob;
```

Keep the scan job creation outside the transaction to avoid coupling scan queue creation to all generated idea writes. If scan job creation fails, let the completion request fail so the worker retry path can run; this keeps the daily scan from being silently skipped.

- [ ] **Step 4: Run persistence test**

Run:

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/generated-inbox-persistence.test.ts --no-file-parallelism --testTimeout 60000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/jobs/inbox-generation.ts tests/generated-inbox-persistence.test.ts
git commit -m "feat: queue novelty scan after inbox generation"
```

---

## Task 8: Render Novelty Evidence in the Inbox

**Files:**
- Modify: `src/lib/jobs/inbox-generation.ts`
- Modify: `src/app/inbox/[userId]/page.tsx`
- Modify: `src/components/IdeaCard.tsx`
- Test: `tests/paper-idea-group.test.tsx`

- [ ] **Step 1: Write UI test**

Update the idea fixture in `tests/paper-idea-group.test.tsx` to include a novelty scan:

```ts
noveltyScan: {
  label: "crowded",
  confidence: 0.82,
  summary: "Several adjacent benchmark systems exist.",
  overlapExplanation: "The idea needs a sharper differentiator.",
  evidence: [
    {
      title: "Adjacent benchmark paper",
      url: "https://arxiv.org/abs/2606.00002",
      sourceType: "arxiv",
      overlapLevel: "adjacent",
      confidence: 0.8
    }
  ]
}
```

Add assertions:

```ts
expect(screen.getByText("crowded")).toBeInTheDocument();
expect(screen.getByText("82% confidence")).toBeInTheDocument();
expect(screen.getByText("Several adjacent benchmark systems exist.")).toBeInTheDocument();
expect(screen.getByText("Adjacent benchmark paper")).toHaveAttribute(
  "href",
  "https://arxiv.org/abs/2606.00002"
);
```

- [ ] **Step 2: Include latest novelty scan in inbox state**

In `src/lib/jobs/inbox-generation.ts`, update `getGeneratedInboxState()` include:

```ts
const ideas = await prisma.generatedIdea.findMany({
  where: { userId, inboxDate },
  orderBy: [{ overallScore: "desc" }],
  include: {
    paper: true,
    citations: true,
    noveltyScans: {
      orderBy: { createdAt: "desc" },
      take: 1,
      include: {
        evidence: {
          orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
          take: 3
        }
      }
    }
  }
});
```

- [ ] **Step 3: Pass novelty scan to cards**

In `src/app/inbox/[userId]/page.tsx`, update `groupIdeasByPaper()`:

```ts
const latestNoveltyScan = idea.noveltyScans[0] ?? null;

group.ideas.push({
  id: idea.id,
  title: idea.title,
  summary: idea.summary,
  expandedExplanation: idea.expandedExplanation,
  trajectory: idea.trajectory,
  noveltyStatus: idea.noveltyStatus,
  overallScore: idea.overallScore,
  scoreExplanations: parseScoreExplanations(idea.scoreExplanationsJson),
  noveltyScan: latestNoveltyScan
    ? {
        label: latestNoveltyScan.label,
        confidence: latestNoveltyScan.confidence,
        summary: latestNoveltyScan.summary,
        overlapExplanation: latestNoveltyScan.overlapExplanation,
        evidence: latestNoveltyScan.evidence.map((evidence) => ({
          title: evidence.title,
          url: evidence.url,
          sourceType: evidence.sourceType,
          overlapLevel: evidence.overlapLevel,
          confidence: evidence.confidence
        }))
      }
    : null
});
```

- [ ] **Step 4: Render evidence in `IdeaCard`**

In `src/components/IdeaCard.tsx`, extend the prop type:

```ts
noveltyScan?: null | {
  label: string;
  confidence: number;
  summary: string;
  overlapExplanation: string;
  evidence: Array<{
    title: string;
    url: string;
    sourceType: string;
    overlapLevel: string;
    confidence: number;
  }>;
};
```

Render after the summary:

```tsx
{idea.noveltyScan ? (
  <div className="mt-3 rounded-md border border-rf-border bg-rf-panel p-3 text-sm text-rf-muted">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-rf-white">{idea.noveltyScan.label.replaceAll("_", " ")}</span>
      <span>{Math.round(idea.noveltyScan.confidence * 100)}% confidence</span>
    </div>
    <p className="mt-2">{idea.noveltyScan.summary}</p>
    <p className="mt-2">{idea.noveltyScan.overlapExplanation}</p>
    {idea.noveltyScan.evidence.length > 0 ? (
      <div className="mt-3 grid gap-2">
        {idea.noveltyScan.evidence.map((evidence) => (
          <a
            key={`${evidence.sourceType}-${evidence.url}-${evidence.title}`}
            href={evidence.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded border border-rf-border px-3 py-2 text-rf-white hover:bg-rf-surface"
          >
            <span className="block font-medium">{evidence.title}</span>
            <span className="text-xs text-rf-muted">
              {evidence.sourceType} / {evidence.overlapLevel} / {Math.round(evidence.confidence * 100)}%
            </span>
          </a>
        ))}
      </div>
    ) : null}
  </div>
) : null}
```

- [ ] **Step 5: Run UI tests**

Run:

```powershell
npm test -- tests/paper-idea-group.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/jobs/inbox-generation.ts src/app/inbox/[userId]/page.tsx src/components/IdeaCard.tsx tests/paper-idea-group.test.tsx
git commit -m "feat: show novelty evidence in inbox"
```

---

## Task 9: Verification, Migration, and Deployment Notes

**Files:**
- Modify: `docs/deployment.md`
- Optional Modify: `.env.example`

- [ ] **Step 1: Update docs**

In `docs/deployment.md`, add:

```md
## Daily Novelty Scan

After an inbox generation job completes, ResearchFinder queues a `novelty_scan` worker job.
The local Windows worker claims it automatically after `inbox_generation` jobs and before
`viability_check` jobs. The scan uses bounded arXiv/open-scholar/web evidence gathering and
persists novelty labels plus evidence for the inbox UI.

No paid search API key is required for the first version. If optional scholarly or web adapters
are rate limited, the scan records adapter failures and continues with partial evidence.
```

- [ ] **Step 2: Run focused tests**

Run:

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/v2-schemas.test.ts tests/novelty-query-builder.test.ts tests/novelty-source-adapters.test.ts tests/novelty-scan-job.test.ts tests/researchfinder-worker.test.ts tests/generated-inbox-persistence.test.ts tests/paper-idea-group.test.tsx --no-file-parallelism --testTimeout 60000
```

Expected: all listed tests pass.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm run lint
npx tsc --noEmit --pretty false
npm run build
```

Expected: all commands exit 0. Known existing warnings from Next/Auth/Prisma are acceptable if unchanged.

- [ ] **Step 4: Run full test suite with Postgres**

Run:

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- --no-file-parallelism --testTimeout 60000
```

Expected: all tests pass except existing intentional skips.

- [ ] **Step 5: Apply production migration**

After merge to `main` and before relying on the feature in production, run against the deployed Neon database:

```powershell
npm run db:deploy
```

Expected: migration `20260625170000_daily_novelty_scan` is applied successfully.

- [ ] **Step 6: Live smoke test**

Trigger the daily cron once:

```powershell
curl.exe -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://research-finder-lake.vercel.app/api/cron/candidates
```

Run the local worker once if the persistent scheduled task is not already running:

```powershell
$env:RESEARCHFINDER_WORKER_CONFIG='C:\Users\solvis\AppData\Local\ResearchFinderWorker\.worker.json'
npm run worker:once
```

Expected worker sequence:

```text
Claimed inbox_generation job <id>
Completed inbox_generation job <id>
```

Run again:

```powershell
$env:RESEARCHFINDER_WORKER_CONFIG='C:\Users\solvis\AppData\Local\ResearchFinderWorker\.worker.json'
npm run worker:once
```

Expected:

```text
Claimed novelty_scan job <id>
Completed novelty_scan job <id>
```

- [ ] **Step 7: Commit docs and final changes**

```powershell
git add docs/deployment.md .env.example
git commit -m "docs: document daily novelty scan"
```

---

## Implementation Notes

- Keep the worker job priority order: `inbox_generation`, then `novelty_scan`, then `viability_check`.
- Do not block showing the generated inbox if novelty scan fails.
- Do not force a distribution of labels.
- Keep `needs_novelty_check` valid for old data and viability verdicts.
- Use `not_checked` for generated ideas before the novelty scan has run.
- The morning novelty scan should be bounded. The separate dispatch sprint is where 1-3 hour prototype work belongs.
