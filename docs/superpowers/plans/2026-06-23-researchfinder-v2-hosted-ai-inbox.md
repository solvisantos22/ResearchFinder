# ResearchFinder V2 Hosted AI Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hosted, Google-gated, Postgres-backed ResearchFinder V2 foundation with AI-generated inbox jobs, Windows Codex workers, rich idea cards, and worker-based viability checks.

**Architecture:** Keep one Next.js app as the hosted control plane and use Postgres as the durable state store. Run Codex only through a per-user Windows companion worker that authenticates to ResearchFinder with scoped worker tokens, claims only that user's jobs, validates structured JSON, and uploads results. Deliver in phases so the hosted foundation is usable before the AI worker pipeline is complete.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma 6, Postgres, Auth.js/NextAuth with Google provider, Zod, Vitest, Tailwind, PowerShell scheduled-task installer, local Codex CLI.

---

## Scope Note

The approved spec covers several subsystems. This plan keeps them in one roadmap because the data model and ownership rules need to line up, but execution should stop at each phase gate and verify the app before continuing.

Phase gates:

1. Foundation and redesign can ship with seeded/demo data.
2. AI inbox jobs and worker can ship before rich UI polish is complete.
3. Rich idea cards can ship before worker-based viability.
4. Viability worker can ship before any research-sprint or paper-writing work.

## File Structure

Create or modify these files during the plan:

- `package.json` and `package-lock.json`: add Auth.js, Prisma adapter, Postgres migration scripts, worker scripts.
- `.env.example`: production and local variables for Postgres, Google auth, cron, and worker tokens.
- `docker-compose.yml`: local Postgres for development and tests.
- `prisma/schema.prisma`: move to Postgres and add Auth.js, profile, source, job, idea, citation, worker, and log models.
- `src/auth.ts`: Auth.js configuration, Google provider, Prisma adapter, and allowlist callback.
- `src/app/api/auth/[...nextauth]/route.ts`: Auth.js route handler.
- `src/lib/auth/allowed-emails.ts`: email allowlist parsing.
- `src/lib/auth/session.ts`: server session helper and current-user helpers.
- `src/lib/auth/permissions.ts`: profile visibility and dispatch permission checks.
- `src/middleware.ts`: route protection using Auth.js instead of token query params.
- `src/lib/v2/domain.ts`: v2 constants for job types, statuses, score dimensions, novelty states, and verdicts.
- `src/lib/v2/schemas.ts`: Zod schemas for worker outputs and API payloads.
- `src/lib/profiles/field-presets.ts`: arXiv presets for profile setup.
- `src/lib/profiles/service.ts`: profile CRUD and query construction.
- `src/lib/sources/arxiv-candidates.ts`: arXiv candidate batch creation.
- `src/lib/jobs/inbox-generation.ts`: server-side inbox generation job creation, claiming, and persistence.
- `src/lib/jobs/worker-auth.ts`: worker token hashing, verification, and worker lookup.
- `src/lib/jobs/viability.ts`: v2 worker-based viability job lifecycle.
- `src/app/api/cron/candidates/route.ts`: hosted cron endpoint for candidate batches and inbox jobs.
- `src/app/api/workers/register/route.ts`: worker registration endpoint.
- `src/app/api/workers/claim/route.ts`: worker job claim endpoint.
- `src/app/api/workers/jobs/[jobId]/complete/route.ts`: worker result upload endpoint.
- `src/app/(app)/layout.tsx`: authenticated app shell.
- `src/app/(app)/inbox/[userId]/page.tsx`: v2 inbox page.
- `src/app/(app)/profiles/[userId]/page.tsx`: profile editor.
- `src/app/(app)/workers/page.tsx`: worker setup/status page.
- `src/app/(app)/jobs/[jobId]/page.tsx`: job and viability outcome page.
- `src/components/AppShell.tsx`: left rail, central content, right status column.
- `src/components/IdeaCard.tsx`: generated idea display.
- `src/components/PaperIdeaGroup.tsx`: paper-first grouped card.
- `src/components/WorkerStatusPanel.tsx`: worker and queue state.
- `src/components/ProfileForm.tsx`: profile preset and editable settings form.
- `scripts/researchfinder-worker.ts`: local Windows worker command.
- `scripts/install-worker.ps1`: one-time PowerShell scheduled-task installer.
- `src/worker/codex-runner.ts`: Codex invocation boundary.
- `src/worker/output-validation.ts`: local worker output validation.
- `tests/helpers/postgres.ts`: Postgres test database helper.
- `tests/*.test.ts` and `tests/*.test.tsx`: updated and new tests.

---

### Task 1: Add Hosted Dependencies And Postgres Scripts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Create: `docker-compose.yml`

- [ ] **Step 1: Update dependencies and scripts**

Add Auth.js, Prisma adapter, and cross-env scripts.

```powershell
npm install next-auth @auth/prisma-adapter
npm install -D cross-env
```

Update `package.json` scripts to include:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:seed": "tsx src/lib/seed.ts",
    "ingest:daily": "tsx scripts/ingest-daily.ts",
    "worker:local": "tsx scripts/researchfinder-worker.ts",
    "worker:once": "tsx scripts/process-viability-once.ts"
  }
}
```

- [ ] **Step 2: Add environment template**

Replace `.env.example` with the hosted variables plus local defaults:

```text
DATABASE_URL="postgresql://researchfinder:researchfinder@localhost:54329/researchfinder?schema=public"
TEST_DATABASE_URL="postgresql://researchfinder:researchfinder@localhost:54329/researchfinder?schema=test"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="replace-with-local-secret"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
ALLOWED_GOOGLE_EMAILS="solvi@example.com,collaborator@example.com"
CRON_SECRET="dev-cron-secret"
WORKER_TOKEN_SECRET="dev-worker-token-secret"
RESEARCHFINDER_APP_URL="http://localhost:3000"
```

- [ ] **Step 3: Add local Postgres compose file**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    ports:
      - "54329:5432"
    environment:
      POSTGRES_USER: researchfinder
      POSTGRES_PASSWORD: researchfinder
      POSTGRES_DB: researchfinder
    volumes:
      - researchfinder-postgres:/var/lib/postgresql/data

volumes:
  researchfinder-postgres:
```

- [ ] **Step 4: Verify install baseline**

Run:

```powershell
npm install
npm run lint
```

Expected: install completes, lint still passes before code changes.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json .env.example docker-compose.yml
git commit -m "chore: add hosted app dependencies"
```

---

### Task 2: Introduce V2 Domain Constants And Output Schemas

**Files:**
- Create: `src/lib/v2/domain.ts`
- Create: `src/lib/v2/schemas.ts`
- Create: `tests/v2-schemas.test.ts`

- [ ] **Step 1: Write schema tests first**

Create `tests/v2-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  GeneratedInboxSchema,
  InboxGenerationJobInputSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";

describe("v2 worker schemas", () => {
  it("accepts a generated inbox with 10 or fewer ideas and at most 3 ideas per paper", () => {
    const result = GeneratedInboxSchema.parse({
      inboxDate: "2026-06-23",
      generatedForUserId: "user-1",
      papers: [
        {
          source: "arxiv",
          sourceId: "2606.00001",
          title: "Paper title",
          abstract: "Paper abstract",
          url: "https://arxiv.org/abs/2606.00001",
          authors: ["A. Researcher"],
          categories: ["cs.AI"],
          publishedAt: "2026-06-23T00:00:00.000Z",
          whyPaperMatters: "This paper creates a concrete opening for agent evaluation work.",
          ideas: [
            {
              title: "Build a stress-test benchmark",
              summary: "A concise version of the idea.",
              expandedExplanation: "A longer explanation of the project direction.",
              trajectory: "If viable, this becomes a benchmark paper with reproducible tasks.",
              recommended: true,
              noveltyStatus: "needs_novelty_check",
              scores: {
                relevance: 0.9,
                significance: 0.86,
                originality: 0.78,
                feasibility: 0.82,
                overall: 0.84
              },
              scoreExplanations: {
                relevance: "Directly aligned with the user's profile.",
                significance: "Could produce a meaningful benchmark contribution.",
                originality: "Adjacent work exists, but this framing was not verified as saturated.",
                feasibility: "A small benchmark slice can be created quickly.",
                overall: "Strong enough to show in the inbox."
              },
              risks: ["Related work may already cover the exact stress test."],
              smallestViabilitySprint: "Search related work and create 20 pilot examples.",
              citations: [
                {
                  sourceType: "paper",
                  title: "Paper title",
                  url: "https://arxiv.org/abs/2606.00001",
                  sourceId: "2606.00001",
                  claim: "The idea is grounded in the source paper.",
                  confidence: 0.95
                }
              ]
            }
          ]
        }
      ]
    });

    expect(result.papers[0].ideas[0].noveltyStatus).toBe("needs_novelty_check");
  });

  it("rejects inbox outputs with more than 3 ideas for one paper", () => {
    const paper = {
      source: "arxiv",
      sourceId: "2606.00001",
      title: "Paper title",
      abstract: "Paper abstract",
      url: "https://arxiv.org/abs/2606.00001",
      authors: ["A. Researcher"],
      categories: ["cs.AI"],
      publishedAt: "2026-06-23T00:00:00.000Z",
      whyPaperMatters: "Reason",
      ideas: Array.from({ length: 4 }, (_, index) => ({
        title: `Idea ${index}`,
        summary: "Summary",
        expandedExplanation: "Expanded explanation",
        trajectory: "Trajectory",
        recommended: index === 0,
        noveltyStatus: "verified",
        scores: {
          relevance: 0.8,
          significance: 0.8,
          originality: 0.8,
          feasibility: 0.8,
          overall: 0.8
        },
        scoreExplanations: {
          relevance: "Relevance",
          significance: "Significance",
          originality: "Originality",
          feasibility: "Feasibility",
          overall: "Overall"
        },
        risks: ["Risk"],
        smallestViabilitySprint: "Sprint",
        citations: [
          {
            sourceType: "paper",
            title: "Paper title",
            url: "https://arxiv.org/abs/2606.00001",
            sourceId: "2606.00001",
            claim: "Claim",
            confidence: 0.9
          }
        ]
      }))
    };

    expect(() =>
      GeneratedInboxSchema.parse({
        inboxDate: "2026-06-23",
        generatedForUserId: "user-1",
        papers: [paper]
      })
    ).toThrow();
  });

  it("accepts the inbox job input bundle sent to Codex", () => {
    const input = InboxGenerationJobInputSchema.parse({
      jobId: "job-1",
      userId: "user-1",
      inboxDate: "2026-06-23",
      profile: {
        fieldPreset: "ai_ml",
        keywords: ["agent evaluation"],
        constraints: ["No frontier-scale training"],
        preferredOutputs: ["benchmark"],
        arxivQuery: "cat:cs.AI",
        maxIdeas: 10,
        maxIdeasPerPaper: 3
      },
      candidatePapers: []
    });

    expect(input.profile.maxIdeas).toBe(10);
  });

  it("accepts strict viability verdicts", () => {
    const result = ViabilityResultSchema.parse({
      jobId: "job-1",
      verdict: "needs_novelty_check",
      summary: "Promising but related work is unresolved.",
      feasibility: "A small pilot can be run.",
      noveltyRisk: "Adjacent work exists.",
      minimumExperiment: "Create 20 examples and compare two baselines.",
      blockers: ["Need focused related-work search."],
      citations: [
        {
          sourceType: "paper",
          title: "Source",
          url: "https://arxiv.org/abs/2606.00001",
          sourceId: "2606.00001",
          claim: "Grounded in source.",
          confidence: 0.9
        }
      ]
    });

    expect(result.verdict).toBe("needs_novelty_check");
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
npm test -- tests/v2-schemas.test.ts
```

Expected: FAIL because `src/lib/v2/schemas.ts` does not exist.

- [ ] **Step 3: Add v2 domain constants**

Create `src/lib/v2/domain.ts`:

```ts
export const V2_JOB_TYPES = ["inbox_generation", "viability_check"] as const;
export type V2JobType = (typeof V2_JOB_TYPES)[number];

export const V2_JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "timed_out"
] as const;
export type V2JobStatus = (typeof V2_JOB_STATUSES)[number];

export const NOVELTY_STATUSES = ["verified", "needs_novelty_check", "not_novel"] as const;
export type NoveltyStatus = (typeof NOVELTY_STATUSES)[number];

export const VIABILITY_VERDICTS = [
  "expand",
  "needs_novelty_check",
  "revise",
  "reject"
] as const;
export type ViabilityVerdict = (typeof VIABILITY_VERDICTS)[number];

export const SCORE_DIMENSIONS = [
  "relevance",
  "significance",
  "originality",
  "feasibility",
  "overall"
] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export const MAX_DAILY_IDEAS = 10;
export const MAX_IDEAS_PER_PAPER = 3;

export function clampUnitScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}
```

- [ ] **Step 4: Add Zod schemas**

Create `src/lib/v2/schemas.ts` with the schemas referenced by the test:

```ts
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
```

- [ ] **Step 5: Verify schemas**

Run:

```powershell
npm test -- tests/v2-schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/v2/domain.ts src/lib/v2/schemas.ts tests/v2-schemas.test.ts
git commit -m "feat: add v2 worker schemas"
```

---

### Task 3: Move Test Infrastructure Toward Postgres

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `tests/helpers/postgres.ts`
- Modify: `tests/inbox-service.test.ts`
- Modify: `tests/dispatch-service.test.ts`
- Modify: `tests/viability-service.test.ts`

- [ ] **Step 1: Write Postgres helper**

Create `tests/helpers/postgres.ts`:

```ts
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

function buildSchemaUrl(schemaName: string): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error("TEST_DATABASE_URL must be set for Postgres-backed tests");
  }

  const url = new URL(base);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

function pushSchema(databaseUrl: string): void {
  const prismaCli = "node_modules/prisma/build/index.js";
  execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    },
    stdio: "ignore"
  });
}

export async function withPostgresTestDatabase(
  run: (client: PrismaClient) => Promise<void>
): Promise<void> {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = buildSchemaUrl(schemaName);
  const client = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    pushSchema(databaseUrl);
    await run(client);
  } finally {
    await client.$disconnect();

    const cleanup = new PrismaClient({
      datasourceUrl: buildSchemaUrl("public")
    });
    try {
      await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await cleanup.$disconnect();
    }
  }
}
```

- [ ] **Step 2: Switch Prisma provider to Postgres**

In `prisma/schema.prisma`, replace:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

with:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 3: Update database tests to use helper**

In each test file that currently defines `toSqliteUrl`, `pushSchema`, and `withTestDatabase`, remove those local helpers and import:

```ts
import { withPostgresTestDatabase } from "./helpers/postgres";
```

For nested imports from files under `tests/`, use the same relative import path:

```ts
import { withPostgresTestDatabase } from "./helpers/postgres";
```

Rename calls:

```ts
await withTestDatabase(async (client) => {
  // existing test body
});
```

to:

```ts
await withPostgresTestDatabase(async (client) => {
  // existing test body
});
```

- [ ] **Step 4: Start Postgres and verify expected failures**

Run:

```powershell
docker compose up -d postgres
npm test -- tests/inbox-service.test.ts tests/dispatch-service.test.ts tests/viability-service.test.ts
```

Expected: tests may fail on SQLite-specific assumptions or schema incompatibilities. Record each failure before changing test assertions.

- [ ] **Step 5: Fix Postgres-specific assertion issues**

Use these rules:

```text
- Date assertions should keep using toISOString().
- Unique constraint behavior should be asserted through Prisma errors only where the test already relies on an error.
- Do not skip tests to pass the migration.
- Do not reintroduce SQLite-only temp databases.
```

- [ ] **Step 6: Verify database tests**

Run:

```powershell
npm test -- tests/inbox-service.test.ts tests/dispatch-service.test.ts tests/viability-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add prisma/schema.prisma tests/helpers/postgres.ts tests/inbox-service.test.ts tests/dispatch-service.test.ts tests/viability-service.test.ts
git commit -m "test: move prisma tests to postgres"
```

---

### Task 4: Expand Prisma Schema For Hosted V2

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `tests/prisma-schema-shape.test.ts`

- [ ] **Step 1: Write schema shape test**

Create `tests/prisma-schema-shape.test.ts`:

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("v2 prisma schema shape", () => {
  it("uses postgresql provider", () => {
    expect(schema).toContain('provider = "postgresql"');
  });

  it("defines hosted auth, worker, inbox generation, and citation models", () => {
    for (const modelName of [
      "Account",
      "Session",
      "VerificationToken",
      "AllowedEmail",
      "FieldPreset",
      "PaperSource",
      "CandidateBatch",
      "CandidatePaper",
      "InboxGenerationJob",
      "GeneratedIdea",
      "IdeaCitation",
      "WorkerRegistration",
      "WorkerJobLog"
    ]) {
      expect(schema).toContain(`model ${modelName} `);
    }
  });
});
```

- [ ] **Step 2: Run schema shape test and verify failure**

Run:

```powershell
npm test -- tests/prisma-schema-shape.test.ts
```

Expected: FAIL because the new models are not present.

- [ ] **Step 3: Add Auth.js models**

Add the Auth.js Prisma adapter models to `prisma/schema.prisma`:

```prisma
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

Add to `User`:

```prisma
  accounts Account[]
  sessions Session[]
```

- [ ] **Step 4: Add profile and source expansion models**

Extend `ResearchProfile`:

```prisma
  fieldPresetKey          String
  keywordsJson            String
  normalDailyRuntimeMin   Int      @default(45)
  maxDailyRuntimeMin      Int      @default(120)
  maxPapersScreened       Int      @default(40)
  maxPapersDeepRead       Int      @default(6)
  allowPdfFetch           Boolean  @default(false)
  allowRelatedWorkSearch  Boolean  @default(true)
```

Add models:

```prisma
model AllowedEmail {
  id        String   @id @default(cuid())
  email     String   @unique
  label     String
  createdAt DateTime @default(now())
}

model FieldPreset {
  key                  String   @id
  label                String
  arxivCategoriesJson  String
  defaultKeywordsJson  String
  defaultOutputsJson   String
  defaultConstraintsJson String
  defaultArxivQuery    String
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

model PaperSource {
  id        String   @id @default(cuid())
  type      String
  sourceId  String
  url       String
  title     String
  metadataJson String
  createdAt DateTime @default(now())

  @@unique([type, sourceId])
}
```

- [ ] **Step 5: Add candidate and inbox generation models**

Add:

```prisma
model CandidateBatch {
  id          String   @id @default(cuid())
  userId      String
  inboxDate   String
  source      String
  query       String
  status      String
  createdAt   DateTime @default(now())
  completedAt DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  candidates CandidatePaper[]
  inboxGenerationJobs InboxGenerationJob[]

  @@index([userId, inboxDate])
}

model CandidatePaper {
  id          String   @id @default(cuid())
  batchId     String
  arxivId     String
  title       String
  abstract    String
  url         String
  publishedAt DateTime
  authorsJson String
  categoriesJson String
  rawJson     String
  createdAt   DateTime @default(now())

  batch CandidateBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@unique([batchId, arxivId])
}

model InboxGenerationJob {
  id             String   @id @default(cuid())
  userId         String
  candidateBatchId String
  inboxDate      String
  status         String
  claimedByWorkerId String?
  errorMessage   String?
  inputJson      String
  outputJson     String?
  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  candidateBatch CandidateBatch @relation(fields: [candidateBatchId], references: [id], onDelete: Cascade)

  @@index([userId, inboxDate, status])
}
```

- [ ] **Step 6: Replace single best idea inbox shape with generated idea shape**

Add:

```prisma
model GeneratedIdea {
  id                    String   @id @default(cuid())
  userId                String
  paperId               String
  inboxGenerationJobId  String?
  inboxDate             String
  title                 String
  summary               String
  expandedExplanation   String
  trajectory            String
  recommended           Boolean  @default(false)
  noveltyStatus         String
  relevanceScore        Float
  significanceScore     Float
  originalityScore      Float
  feasibilityScore      Float
  overallScore          Float
  scoreExplanationsJson String
  risksJson             String
  smallestSprint        String
  generatedBy           String
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  paper Paper @relation(fields: [paperId], references: [id], onDelete: Cascade)
  citations IdeaCitation[]
  viabilityJobs ViabilityJob[]

  @@index([userId, inboxDate, overallScore])
}

model IdeaCitation {
  id          String   @id @default(cuid())
  generatedIdeaId String
  sourceType  String
  title       String
  url         String
  sourceId    String?
  claim       String
  confidence  Float
  createdAt   DateTime @default(now())

  generatedIdea GeneratedIdea @relation(fields: [generatedIdeaId], references: [id], onDelete: Cascade)
}
```

Keep the existing `Idea` and `InboxItem` models until the new UI and services no longer use them. Removing them belongs in a separate cleanup commit after v2 tests pass.

- [ ] **Step 7: Add worker registration and logs**

Add:

```prisma
model WorkerRegistration {
  id            String   @id @default(cuid())
  userId        String
  label         String
  tokenHash     String
  status        String
  lastSeenAt    DateTime?
  createdAt     DateTime @default(now())
  revokedAt     DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  logs WorkerJobLog[]

  @@index([userId, status])
}

model WorkerJobLog {
  id        String   @id @default(cuid())
  workerId  String
  jobType   String
  jobId     String
  level     String
  message   String
  createdAt DateTime @default(now())

  worker WorkerRegistration @relation(fields: [workerId], references: [id], onDelete: Cascade)

  @@index([jobType, jobId])
}
```

- [ ] **Step 8: Update relations**

Add these relations to `User`:

```prisma
  generatedIdeas GeneratedIdea[]
  candidateBatches CandidateBatch[]
  inboxGenerationJobs InboxGenerationJob[]
  workers WorkerRegistration[]
```

Add to `Paper`:

```prisma
  generatedIdeas GeneratedIdea[]
```

Add to `ViabilityJob`:

```prisma
  generatedIdeaId String?
  generatedIdea GeneratedIdea? @relation(fields: [generatedIdeaId], references: [id], onDelete: Cascade)
```

- [ ] **Step 9: Validate schema**

Run:

```powershell
npm run db:generate
npm test -- tests/prisma-schema-shape.test.ts
```

Expected: Prisma Client generates and schema shape test passes.

- [ ] **Step 10: Create migration**

Run:

```powershell
npm run db:migrate -- --name hosted_ai_inbox_v2
```

Expected: Prisma creates a migration under `prisma/migrations/`.

- [ ] **Step 11: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations tests/prisma-schema-shape.test.ts
git commit -m "feat: expand schema for hosted ai inbox"
```

---

### Task 5: Add Google Auth Allowlist And Session Helpers

**Files:**
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/lib/auth/allowed-emails.ts`
- Create: `src/lib/auth/session.ts`
- Create: `src/lib/auth/permissions.ts`
- Modify: `src/middleware.ts`
- Create: `tests/auth-allowlist.test.ts`
- Create: `tests/permissions.test.ts`

- [ ] **Step 1: Write allowlist tests**

Create `tests/auth-allowlist.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isAllowedGoogleEmail, parseAllowedGoogleEmails } from "@/lib/auth/allowed-emails";

describe("Google email allowlist", () => {
  it("normalizes configured allowed emails", () => {
    expect(parseAllowedGoogleEmails(" Solvi@Example.com,collab@example.com ")).toEqual([
      "solvi@example.com",
      "collab@example.com"
    ]);
  });

  it("accepts only allowlisted emails", () => {
    expect(isAllowedGoogleEmail("SOLVI@example.com", ["solvi@example.com"])).toBe(true);
    expect(isAllowedGoogleEmail("unknown@example.com", ["solvi@example.com"])).toBe(false);
    expect(isAllowedGoogleEmail(undefined, ["solvi@example.com"])).toBe(false);
  });
});
```

- [ ] **Step 2: Implement allowlist parser**

Create `src/lib/auth/allowed-emails.ts`:

```ts
export function parseAllowedGoogleEmails(value = process.env.ALLOWED_GOOGLE_EMAILS ?? "") {
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isAllowedGoogleEmail(email: string | null | undefined, allowed = parseAllowedGoogleEmails()) {
  if (!email) return false;
  return allowed.includes(email.trim().toLowerCase());
}
```

- [ ] **Step 3: Add Auth.js config**

Create `src/auth.ts`:

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { prisma } from "@/lib/db";
import { isAllowedGoogleEmail } from "@/lib/auth/allowed-emails";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    })
  ],
  callbacks: {
    async signIn({ user }) {
      return isAllowedGoogleEmail(user.email);
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    }
  }
});
```

Add a type augmentation file `src/types/next-auth.d.ts`:

```ts
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
```

- [ ] **Step 4: Add route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 5: Add server session helper**

Create `src/lib/auth/session.ts`:

```ts
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function requireCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id }
  });

  if (!user) {
    notFound();
  }

  return user;
}
```

- [ ] **Step 6: Write permission tests**

Create `tests/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  canDispatchIdeaForProfile,
  canViewUserResearch
} from "@/lib/auth/permissions";

describe("v2 permissions", () => {
  it("allows shared viewing between allowed users", () => {
    expect(canViewUserResearch({ currentUserId: "user-1", targetUserId: "user-2" })).toBe(true);
  });

  it("allows dispatch only for own generated idea", () => {
    expect(
      canDispatchIdeaForProfile({
        currentUserId: "user-1",
        generatedForUserId: "user-1"
      })
    ).toBe(true);

    expect(
      canDispatchIdeaForProfile({
        currentUserId: "user-1",
        generatedForUserId: "user-2"
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 7: Implement permission helpers**

Create `src/lib/auth/permissions.ts`:

```ts
export function canViewUserResearch(_: { currentUserId: string; targetUserId: string }) {
  return true;
}

export function canEditProfile(input: { currentUserId: string; targetUserId: string }) {
  return input.currentUserId === input.targetUserId;
}

export function canDispatchIdeaForProfile(input: {
  currentUserId: string;
  generatedForUserId: string;
}) {
  return input.currentUserId === input.generatedForUserId;
}
```

- [ ] **Step 8: Replace token middleware**

Modify `src/middleware.ts` to use Auth.js for app routes and leave worker/API auth inside route handlers:

```ts
export { auth as middleware } from "@/auth";

export const config = {
  matcher: ["/((?!api/auth|api/workers|api/cron|_next/static|_next/image|favicon.ico).*)"]
};
```

- [ ] **Step 9: Verify auth helpers**

Run:

```powershell
npm test -- tests/auth-allowlist.test.ts tests/permissions.test.ts
npm run lint
```

Expected: tests and lint pass.

- [ ] **Step 10: Commit**

```powershell
git add src/auth.ts src/app/api/auth src/lib/auth src/types src/middleware.ts tests/auth-allowlist.test.ts tests/permissions.test.ts
git commit -m "feat: add google allowlist auth"
```

---

### Task 6: Build Profile Presets And Profile Service

**Files:**
- Create: `src/lib/profiles/field-presets.ts`
- Create: `src/lib/profiles/service.ts`
- Modify: `src/lib/seed.ts`
- Create: `tests/profile-presets.test.ts`
- Create: `tests/profile-service.test.ts`

- [ ] **Step 1: Write preset tests**

Create `tests/profile-presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildPresetProfileData, fieldPresets } from "@/lib/profiles/field-presets";

describe("field presets", () => {
  it("includes AI/ML and chemistry arXiv presets", () => {
    expect(fieldPresets.ai_ml.defaultArxivQuery).toContain("cat:cs.AI");
    expect(fieldPresets.chemistry.defaultArxivQuery).toContain("cat:physics.chem-ph");
  });

  it("builds editable profile defaults from a preset", () => {
    const profile = buildPresetProfileData("ai_ml");
    expect(profile.fieldPresetKey).toBe("ai_ml");
    expect(JSON.parse(profile.keywordsJson)).toContain("LLM evaluation");
    expect(profile.maxDailyPapers).toBe(10);
  });
});
```

- [ ] **Step 2: Implement presets**

Create `src/lib/profiles/field-presets.ts`:

```ts
import { encodeJsonField } from "@/lib/seed";
import { defaultRankingWeights } from "@/lib/domain";

export const fieldPresets = {
  ai_ml: {
    label: "AI / ML",
    categories: ["cs.AI", "cs.CL", "cs.LG"],
    keywords: [
      "LLM evaluation",
      "multi-agent systems",
      "benchmark design",
      "agentic research workflows"
    ],
    preferredOutputs: ["benchmark", "evaluation harness", "open-source tool"],
    constraints: [
      "Prefer credible prototypes in 1-3 weeks",
      "Avoid frontier-scale model training"
    ],
    defaultArxivQuery:
      "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND (all:LLM OR all:evaluation OR all:agent OR all:benchmark OR all:reasoning)"
  },
  chemistry: {
    label: "Chemistry",
    categories: ["physics.chem-ph", "cond-mat.mtrl-sci", "q-bio.BM"],
    keywords: ["catalysis", "materials discovery", "molecular simulation"],
    preferredOutputs: ["simulation", "dataset", "reproducible analysis"],
    constraints: ["Prefer computational or literature-grounded projects first"],
    defaultArxivQuery:
      "(cat:physics.chem-ph OR cat:cond-mat.mtrl-sci OR cat:q-bio.BM) AND (all:catalysis OR all:materials OR all:molecular OR all:synthesis)"
  }
} as const;

export type FieldPresetKey = keyof typeof fieldPresets;

export function buildPresetProfileData(key: FieldPresetKey) {
  const preset = fieldPresets[key];
  return {
    fieldPresetKey: key,
    interestsJson: encodeJsonField(preset.keywords),
    keywordsJson: encodeJsonField(preset.keywords),
    constraintsJson: encodeJsonField(preset.constraints),
    preferredOutputsJson: encodeJsonField(preset.preferredOutputs),
    rankingWeightsJson: encodeJsonField(defaultRankingWeights),
    arxivQuery: preset.defaultArxivQuery,
    maxDailyPapers: 10,
    normalDailyRuntimeMin: 45,
    maxDailyRuntimeMin: 120,
    maxPapersScreened: 40,
    maxPapersDeepRead: 6,
    allowPdfFetch: false,
    allowRelatedWorkSearch: true
  };
}
```

- [ ] **Step 3: Add profile service tests**

Create `tests/profile-service.test.ts` using `withPostgresTestDatabase`; assert that users can update only their own profile:

```ts
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

const servicePromise = import("@/lib/profiles/service");

describe("profile service", () => {
  it("creates a preset profile for a user", async () => {
    const { ensureProfileForUser } = await servicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      await client.user.create({
        data: { id: "user-1", email: "user-1@example.com", name: "User One" }
      });

      const profile = await ensureProfileForUser("user-1", "ai_ml");

      expect(profile.fieldPresetKey).toBe("ai_ml");
      expect(profile.arxivQuery).toContain("cat:cs.AI");
    });
  });
});
```

- [ ] **Step 4: Implement profile service**

Create `src/lib/profiles/service.ts`:

```ts
import { prisma } from "@/lib/db";
import { buildPresetProfileData, type FieldPresetKey } from "@/lib/profiles/field-presets";

export async function ensureProfileForUser(userId: string, presetKey: FieldPresetKey) {
  const existing = await prisma.researchProfile.findUnique({ where: { userId } });
  if (existing) return existing;

  return prisma.researchProfile.create({
    data: {
      userId,
      ...buildPresetProfileData(presetKey)
    }
  });
}

export async function updateOwnProfile(input: {
  currentUserId: string;
  targetUserId: string;
  arxivQuery: string;
  keywords: string[];
  constraints: string[];
  preferredOutputs: string[];
}) {
  if (input.currentUserId !== input.targetUserId) {
    throw new Error("Cannot edit another user's profile");
  }

  return prisma.researchProfile.update({
    where: { userId: input.targetUserId },
    data: {
      arxivQuery: input.arxivQuery,
      keywordsJson: JSON.stringify(input.keywords),
      interestsJson: JSON.stringify(input.keywords),
      constraintsJson: JSON.stringify(input.constraints),
      preferredOutputsJson: JSON.stringify(input.preferredOutputs)
    }
  });
}
```

- [ ] **Step 5: Update seed to use presets**

In `src/lib/seed.ts`, replace `buildProfileSeedData` internals with `buildPresetProfileData("ai_ml")` and keep user-specific interests by overriding `keywordsJson` and `interestsJson`.

- [ ] **Step 6: Verify profile tests**

Run:

```powershell
npm test -- tests/profile-presets.test.ts tests/profile-service.test.ts tests/profile-json.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/profiles src/lib/seed.ts tests/profile-presets.test.ts tests/profile-service.test.ts
git commit -m "feat: add editable research profiles"
```

---

### Task 7: Implement Dark Command-Center App Shell

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/components/AppShell.tsx`
- Create: `src/components/WorkerStatusPanel.tsx`
- Create: `tests/app-shell.test.tsx`

- [ ] **Step 1: Write app shell render test**

Create `tests/app-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "@/components/AppShell";

describe("AppShell", () => {
  it("renders left navigation, central content, and right status rail", () => {
    render(
      <AppShell
        currentUserName="Solvi"
        workerStatus="online"
        activeSection="inbox"
        rightRail={<div>Queue clear</div>}
      >
        <h1>Today's research inbox</h1>
      </AppShell>
    );

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByText("Today's research inbox")).toBeInTheDocument();
    expect(screen.getByText("Queue clear")).toBeInTheDocument();
    expect(screen.getByText("Worker online")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add app shell component**

Create `src/components/AppShell.tsx`:

```tsx
import Link from "next/link";
import React from "react";

type AppShellProps = {
  currentUserName: string;
  workerStatus: "online" | "offline" | "needs_auth" | "unknown";
  activeSection: "inbox" | "profiles" | "jobs" | "workers";
  rightRail: React.ReactNode;
  children: React.ReactNode;
};

const navItems = [
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "profiles", label: "Profiles", href: "/profiles" },
  { key: "jobs", label: "Jobs", href: "/jobs" },
  { key: "workers", label: "Workers", href: "/workers" }
] as const;

export function AppShell({
  currentUserName,
  workerStatus,
  activeSection,
  rightRail,
  children
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-rf-black text-rf-white">
      <div className="grid min-h-screen grid-cols-[88px_minmax(0,1fr)_320px]">
        <aside className="border-r border-rf-border bg-rf-panel px-3 py-5">
          <div className="mb-8 h-8 w-8 border-2 border-rf-violet shadow-[inset_7px_0_0_#7c4dff]" />
          <nav aria-label="Primary" className="grid gap-2">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={
                  activeSection === item.key
                    ? "grid h-11 place-items-center rounded-md bg-rf-violet text-xs font-semibold text-white"
                    : "grid h-11 place-items-center rounded-md border border-rf-border text-xs font-semibold text-rf-muted"
                }
              >
                {item.label.slice(0, 1)}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 px-8 py-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-rf-violet">
                ResearchFinder
              </p>
              <p className="mt-1 text-sm text-rf-muted">Signed in as {currentUserName}</p>
            </div>
            <div className="rounded-md border border-rf-border bg-rf-panel px-3 py-2 text-sm text-rf-muted">
              Worker {workerStatus.replace("_", " ")}
            </div>
          </div>
          {children}
        </main>

        <aside className="border-l border-rf-border bg-rf-panel px-5 py-7">{rightRail}</aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add dark tokens**

Modify `src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
  background: #050507;
  color: #f8f7ff;
}

body {
  margin: 0;
  background: #050507;
  color: #f8f7ff;
  font-family: Roboto, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

a {
  color: inherit;
  text-decoration: none;
}
```

Extend `tailwind.config.ts` colors:

```ts
colors: {
  rf: {
    black: "#050507",
    panel: "#09080d",
    surface: "#0d0b12",
    border: "#2f293d",
    violet: "#651fff",
    violetSoft: "#7c4dff",
    white: "#f8f7ff",
    muted: "#aaa3bc"
  }
}
```

- [ ] **Step 4: Verify shell**

Run:

```powershell
npm test -- tests/app-shell.test.tsx
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/globals.css src/app/layout.tsx src/app/(app)/layout.tsx src/components/AppShell.tsx src/components/WorkerStatusPanel.tsx tests/app-shell.test.tsx tailwind.config.ts
git commit -m "feat: add dark command center shell"
```

---

### Task 8: Create Candidate Batch And Inbox Generation Jobs

**Files:**
- Create: `src/lib/sources/arxiv-candidates.ts`
- Create: `src/lib/jobs/inbox-generation.ts`
- Create: `src/app/api/cron/candidates/route.ts`
- Create: `tests/inbox-generation-job.test.ts`

- [ ] **Step 1: Write job creation tests**

Create `tests/inbox-generation-job.test.ts` with `withPostgresTestDatabase`. Test that a candidate batch creates one queued job for the profile owner and does not create duplicate jobs for the same date.

```ts
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

const servicePromise = import("@/lib/jobs/inbox-generation");

describe("inbox generation jobs", () => {
  it("creates one queued inbox generation job per user/date", async () => {
    const { createInboxGenerationJob } = await servicePromise;

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({
        data: { id: "user-1", email: "user-1@example.com", name: "User One" }
      });
      const batch = await client.candidateBatch.create({
        data: {
          userId: user.id,
          inboxDate: "2026-06-23",
          source: "arxiv",
          query: "cat:cs.AI",
          status: "completed"
        }
      });

      const first = await createInboxGenerationJob({
        userId: user.id,
        candidateBatchId: batch.id,
        inboxDate: "2026-06-23"
      });
      const second = await createInboxGenerationJob({
        userId: user.id,
        candidateBatchId: batch.id,
        inboxDate: "2026-06-23"
      });

      expect(first.id).toBe(second.id);
      expect(await client.inboxGenerationJob.count()).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Implement inbox generation service**

Create `src/lib/jobs/inbox-generation.ts`:

```ts
import { prisma } from "@/lib/db";

export async function createInboxGenerationJob(input: {
  userId: string;
  candidateBatchId: string;
  inboxDate: string;
}) {
  const existing = await prisma.inboxGenerationJob.findFirst({
    where: {
      userId: input.userId,
      inboxDate: input.inboxDate,
      candidateBatchId: input.candidateBatchId
    }
  });

  if (existing) return existing;

  return prisma.inboxGenerationJob.create({
    data: {
      userId: input.userId,
      candidateBatchId: input.candidateBatchId,
      inboxDate: input.inboxDate,
      status: "queued",
      inputJson: JSON.stringify({ candidateBatchId: input.candidateBatchId })
    }
  });
}
```

- [ ] **Step 3: Implement arXiv candidate batch service**

Create `src/lib/sources/arxiv-candidates.ts`:

```ts
import { fetchArxivPapers } from "@/lib/arxiv/client";
import { prisma } from "@/lib/db";
import { parseJsonField } from "@/lib/seed";

export async function createArxivCandidateBatchForUser(userId: string, inboxDate: string) {
  const profile = await prisma.researchProfile.findUniqueOrThrow({ where: { userId } });
  const papers = await fetchArxivPapers(profile.arxivQuery, profile.maxPapersScreened);

  return prisma.$transaction(async (tx) => {
    const batch = await tx.candidateBatch.create({
      data: {
        userId,
        inboxDate,
        source: "arxiv",
        query: profile.arxivQuery,
        status: "completed"
      }
    });

    await tx.candidatePaper.createMany({
      data: papers.map((paper) => ({
        batchId: batch.id,
        arxivId: paper.arxivId,
        title: paper.title,
        abstract: paper.abstract,
        url: paper.url,
        publishedAt: paper.publishedAt,
        authorsJson: JSON.stringify(paper.authors),
        categoriesJson: JSON.stringify(paper.categories),
        rawJson: JSON.stringify(paper)
      })),
      skipDuplicates: true
    });

    return tx.candidateBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { candidates: true }
    });
  });
}

export function parseCandidateAuthors(value: string) {
  return parseJsonField<string[]>(value);
}
```

- [ ] **Step 4: Add cron route**

Create `src/app/api/cron/candidates/route.ts`:

```ts
import { NextResponse } from "next/server";

import { validateCronRequest } from "@/app/api/cron/ingest/auth";
import { prisma } from "@/lib/db";
import { createInboxGenerationJob } from "@/lib/jobs/inbox-generation";
import { createArxivCandidateBatchForUser } from "@/lib/sources/arxiv-candidates";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const unauthorized = validateCronRequest(request);
  if (unauthorized) return unauthorized;

  const inboxDate = todayIsoDate();
  const users = await prisma.user.findMany({
    where: { profile: { isNot: null } },
    select: { id: true }
  });

  const jobs = [];
  for (const user of users) {
    const batch = await createArxivCandidateBatchForUser(user.id, inboxDate);
    jobs.push(
      await createInboxGenerationJob({
        userId: user.id,
        candidateBatchId: batch.id,
        inboxDate
      })
    );
  }

  return NextResponse.json({ createdJobs: jobs.length });
}
```

- [ ] **Step 5: Verify**

Run:

```powershell
npm test -- tests/inbox-generation-job.test.ts tests/cron-secret.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/sources src/lib/jobs/inbox-generation.ts src/app/api/cron/candidates tests/inbox-generation-job.test.ts
git commit -m "feat: create inbox generation jobs"
```

---

### Task 9: Add Worker Tokens, Registration, And Claim API

**Files:**
- Create: `src/lib/jobs/worker-auth.ts`
- Create: `src/app/api/workers/register/route.ts`
- Create: `src/app/api/workers/claim/route.ts`
- Create: `tests/worker-auth.test.ts`
- Create: `tests/worker-claim.test.ts`

- [ ] **Step 1: Write worker token tests**

Create `tests/worker-auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { hashWorkerToken, verifyWorkerToken } from "@/lib/jobs/worker-auth";

describe("worker token hashing", () => {
  it("verifies only the original token", async () => {
    const hash = await hashWorkerToken("secret-token");

    await expect(verifyWorkerToken("secret-token", hash)).resolves.toBe(true);
    await expect(verifyWorkerToken("wrong-token", hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Implement token helpers**

Use Node crypto instead of adding bcrypt:

```ts
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function createWorkerToken() {
  return randomBytes(32).toString("base64url");
}

export async function hashWorkerToken(token: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(token, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("base64url")}`;
}

export async function verifyWorkerToken(token: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = (await scrypt(token, salt, 64)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function readBearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}
```

- [ ] **Step 3: Write claim tests**

Create `tests/worker-claim.test.ts` asserting:

```text
- worker for user-1 claims oldest queued inbox_generation job for user-1
- worker for user-1 does not claim user-2 jobs
- claimed job is marked running with claimedByWorkerId
```

Use `withPostgresTestDatabase` and call a service function `claimNextWorkerJob`.

- [ ] **Step 4: Implement claim service**

Add to `src/lib/jobs/inbox-generation.ts`:

```ts
export async function claimNextInboxGenerationJob(input: { userId: string; workerId: string }) {
  const job = await prisma.inboxGenerationJob.findFirst({
    where: {
      userId: input.userId,
      status: "queued"
    },
    orderBy: { createdAt: "asc" }
  });

  if (!job) return null;

  const claim = await prisma.inboxGenerationJob.updateMany({
    where: {
      id: job.id,
      status: "queued",
      userId: input.userId
    },
    data: {
      status: "running",
      claimedByWorkerId: input.workerId,
      startedAt: new Date()
    }
  });

  if (claim.count !== 1) return null;

  return prisma.inboxGenerationJob.findUniqueOrThrow({
    where: { id: job.id },
    include: {
      candidateBatch: {
        include: { candidates: true }
      },
      user: {
        include: { profile: true }
      }
    }
  });
}
```

- [ ] **Step 5: Add worker API routes**

`src/app/api/workers/register/route.ts` creates a token for the current Google user and returns it once. `src/app/api/workers/claim/route.ts` reads a bearer token, verifies the worker, and returns a job bundle or `{ job: null }`.

Claim response shape:

```ts
{
  job: {
    type: "inbox_generation",
    id: string,
    input: InboxGenerationJobInput
  } | null
}
```

- [ ] **Step 6: Verify**

Run:

```powershell
npm test -- tests/worker-auth.test.ts tests/worker-claim.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/jobs/worker-auth.ts src/lib/jobs/inbox-generation.ts src/app/api/workers tests/worker-auth.test.ts tests/worker-claim.test.ts
git commit -m "feat: add worker registration and claiming"
```

---

### Task 10: Add Inbox Result Persistence And No-Fallback Rule

**Files:**
- Modify: `src/lib/jobs/inbox-generation.ts`
- Create: `tests/generated-inbox-persistence.test.ts`

- [ ] **Step 1: Write persistence tests**

Create `tests/generated-inbox-persistence.test.ts` asserting:

```text
- GeneratedInboxSchema output creates Paper, GeneratedIdea, and IdeaCitation records.
- More than 10 total ideas is rejected.
- An inbox with no completed AI generation job returns a pending state.
```

The pending-state service should be named `getGeneratedInboxState(userId, inboxDate)`.

- [ ] **Step 2: Implement persistence function**

Add to `src/lib/jobs/inbox-generation.ts`:

```ts
import { GeneratedInboxSchema, type GeneratedInbox } from "@/lib/v2/schemas";

export async function completeInboxGenerationJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  const parsed = GeneratedInboxSchema.parse(input.output);

  const job = await prisma.inboxGenerationJob.findFirstOrThrow({
    where: {
      id: input.jobId,
      claimedByWorkerId: input.workerId,
      status: "running"
    }
  });

  await persistGeneratedInbox(parsed, job.id);

  return prisma.inboxGenerationJob.update({
    where: { id: job.id },
    data: {
      status: "completed",
      outputJson: JSON.stringify(parsed),
      completedAt: new Date()
    }
  });
}

async function persistGeneratedInbox(inbox: GeneratedInbox, jobId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.generatedIdea.deleteMany({
      where: {
        userId: inbox.generatedForUserId,
        inboxDate: inbox.inboxDate
      }
    });

    for (const paperGroup of inbox.papers) {
      const paper = await tx.paper.upsert({
        where: { arxivId: paperGroup.sourceId },
        update: {
          title: paperGroup.title,
          abstract: paperGroup.abstract,
          url: paperGroup.url,
          publishedAt: new Date(paperGroup.publishedAt),
          arxivUpdatedAt: new Date(paperGroup.publishedAt),
          authorsJson: JSON.stringify(paperGroup.authors),
          categoriesJson: JSON.stringify(paperGroup.categories)
        },
        create: {
          arxivId: paperGroup.sourceId,
          title: paperGroup.title,
          abstract: paperGroup.abstract,
          url: paperGroup.url,
          publishedAt: new Date(paperGroup.publishedAt),
          arxivUpdatedAt: new Date(paperGroup.publishedAt),
          authorsJson: JSON.stringify(paperGroup.authors),
          categoriesJson: JSON.stringify(paperGroup.categories)
        }
      });

      for (const ideaInput of paperGroup.ideas) {
        const idea = await tx.generatedIdea.create({
          data: {
            userId: inbox.generatedForUserId,
            paperId: paper.id,
            inboxGenerationJobId: jobId,
            inboxDate: inbox.inboxDate,
            title: ideaInput.title,
            summary: ideaInput.summary,
            expandedExplanation: ideaInput.expandedExplanation,
            trajectory: ideaInput.trajectory,
            recommended: ideaInput.recommended,
            noveltyStatus: ideaInput.noveltyStatus,
            relevanceScore: ideaInput.scores.relevance,
            significanceScore: ideaInput.scores.significance,
            originalityScore: ideaInput.scores.originality,
            feasibilityScore: ideaInput.scores.feasibility,
            overallScore: ideaInput.scores.overall,
            scoreExplanationsJson: JSON.stringify(ideaInput.scoreExplanations),
            risksJson: JSON.stringify(ideaInput.risks),
            smallestSprint: ideaInput.smallestViabilitySprint,
            generatedBy: "codex"
          }
        });

        await tx.ideaCitation.createMany({
          data: ideaInput.citations.map((citation) => ({
            generatedIdeaId: idea.id,
            sourceType: citation.sourceType,
            title: citation.title,
            url: citation.url,
            sourceId: citation.sourceId,
            claim: citation.claim,
            confidence: citation.confidence
          }))
        });
      }
    }
  });
}
```

- [ ] **Step 3: Add inbox state service**

Add:

```ts
export async function getGeneratedInboxState(userId: string, inboxDate: string) {
  const ideas = await prisma.generatedIdea.findMany({
    where: { userId, inboxDate },
    orderBy: [{ overallScore: "desc" }],
    include: {
      paper: true,
      citations: true
    }
  });

  if (ideas.length > 0) {
    return { status: "ready" as const, ideas };
  }

  const latestJob = await prisma.inboxGenerationJob.findFirst({
    where: { userId, inboxDate },
    orderBy: { createdAt: "desc" }
  });

  if (!latestJob) return { status: "pending" as const, ideas: [] };
  if (latestJob.status === "failed") return { status: "failed" as const, ideas: [] };
  return { status: latestJob.status as "queued" | "running" | "completed" | "timed_out", ideas: [] };
}
```

- [ ] **Step 4: Verify no fallback behavior**

Run:

```powershell
npm test -- tests/generated-inbox-persistence.test.ts
```

Expected: PASS and no test imports `src/lib/ranking/ideaGenerator.ts`.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/jobs/inbox-generation.ts tests/generated-inbox-persistence.test.ts
git commit -m "feat: persist ai generated inboxes"
```

---

### Task 11: Add Windows Worker Skeleton And Codex Runner Boundary

**Files:**
- Create: `scripts/researchfinder-worker.ts`
- Create: `scripts/install-worker.ps1`
- Create: `src/worker/codex-runner.ts`
- Create: `src/worker/output-validation.ts`
- Create: `tests/codex-runner.test.ts`
- Create: `tests/worker-output-validation.test.ts`

- [ ] **Step 1: Write runner tests**

Create `tests/codex-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildCodexExecArgs } from "@/worker/codex-runner";

describe("codex runner", () => {
  it("builds codex exec arguments for json-only worker prompts", () => {
    expect(buildCodexExecArgs("prompt-file.md")).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--file",
      "prompt-file.md"
    ]);
  });
});
```

- [ ] **Step 2: Implement Codex runner boundary**

Create `src/worker/codex-runner.ts`:

```ts
import { spawn } from "node:child_process";

export function buildCodexExecArgs(promptFile: string) {
  return ["exec", "--json", "--skip-git-repo-check", "--file", promptFile];
}

export async function runCodex(promptFile: string): Promise<string> {
  const args = buildCodexExecArgs(promptFile);

  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`codex exited with ${code}: ${stderr}`));
    });
  });
}
```

- [ ] **Step 3: Add output validation helper**

Create `src/worker/output-validation.ts`:

```ts
import { GeneratedInboxSchema, ViabilityResultSchema } from "@/lib/v2/schemas";

export function parseInboxGenerationOutput(raw: string) {
  return GeneratedInboxSchema.parse(JSON.parse(raw));
}

export function parseViabilityOutput(raw: string) {
  return ViabilityResultSchema.parse(JSON.parse(raw));
}
```

- [ ] **Step 4: Add worker script skeleton**

Create `scripts/researchfinder-worker.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

type WorkerConfig = {
  appUrl: string;
  workerToken: string;
};

function loadConfig(): WorkerConfig {
  const configPath = process.env.RESEARCHFINDER_WORKER_CONFIG ?? join(process.cwd(), ".worker.json");
  return JSON.parse(readFileSync(configPath, "utf8")) as WorkerConfig;
}

async function main() {
  const config = loadConfig();
  const response = await fetch(`${config.appUrl}/api/workers/claim`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.workerToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Worker claim failed with ${response.status}`);
  }

  const payload = (await response.json()) as { job: null | { id: string; type: string; input: unknown } };
  if (!payload.job) {
    console.log("No ResearchFinder worker job available");
    return;
  }

  console.log(`Claimed ${payload.job.type} job ${payload.job.id}`);
  throw new Error(`No local executor is registered for ${payload.job.type} in this worker slice`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 5: Add PowerShell installer**

Create `scripts/install-worker.ps1`:

```powershell
param(
  [Parameter(Mandatory=$true)][string]$AppUrl,
  [Parameter(Mandatory=$true)][string]$WorkerToken,
  [string]$InstallDir = "$env:LOCALAPPDATA\ResearchFinderWorker"
)

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$configPath = Join-Path $InstallDir ".worker.json"
@{
  appUrl = $AppUrl
  workerToken = $WorkerToken
} | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

$node = (Get-Command node -ErrorAction Stop).Source
$codex = (Get-Command codex -ErrorAction Stop).Source

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "node_modules/tsx/dist/cli.mjs scripts/researchfinder-worker.ts" `
  -WorkingDirectory (Get-Location).Path

$trigger = New-ScheduledTaskTrigger -Daily -At 6:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun

Register-ScheduledTask `
  -TaskName "ResearchFinder Worker" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Runs local Codex-backed ResearchFinder jobs for the signed-in user." `
  -Force | Out-Null

Write-Output "ResearchFinder worker installed. Config: $configPath. Codex: $codex"
```

- [ ] **Step 6: Verify worker skeleton**

Run:

```powershell
npm test -- tests/codex-runner.test.ts tests/worker-output-validation.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add scripts/researchfinder-worker.ts scripts/install-worker.ps1 src/worker tests/codex-runner.test.ts tests/worker-output-validation.test.ts
git commit -m "feat: add windows codex worker skeleton"
```

---

### Task 12: Build Rich AI Inbox UI

**Files:**
- Create: `src/components/PaperIdeaGroup.tsx`
- Create: `src/components/IdeaCard.tsx`
- Modify: `src/app/(app)/inbox/[userId]/page.tsx`
- Create: `tests/paper-idea-group.test.tsx`

- [ ] **Step 1: Write grouped UI test**

Create `tests/paper-idea-group.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaperIdeaGroup } from "@/components/PaperIdeaGroup";

describe("PaperIdeaGroup", () => {
  it("groups multiple ideas under one paper and hides dispatch for read-only views", () => {
    render(
      <PaperIdeaGroup
        currentUserId="user-1"
        generatedForUserId="user-2"
        paper={{
          title: "Paper",
          abstract: "Abstract",
          url: "https://arxiv.org/abs/2606.00001",
          authors: ["Author"],
          categories: ["cs.AI"],
          publishedAt: "2026-06-23"
        }}
        ideas={[
          {
            id: "idea-1",
            title: "Idea one",
            summary: "Summary one",
            expandedExplanation: "Expanded",
            trajectory: "Trajectory",
            noveltyStatus: "needs_novelty_check",
            overallScore: 0.9,
            scoreExplanations: {
              relevance: "Relevant",
              significance: "Significant",
              originality: "Original",
              feasibility: "Feasible",
              overall: "Overall"
            }
          }
        ]}
      />
    );

    expect(screen.getByText("Paper")).toBeInTheDocument();
    expect(screen.getByText("Idea one")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dispatch/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Needs novelty check/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement IdeaCard**

Create `src/components/IdeaCard.tsx` with visible score explanations inside `<details>`:

```tsx
import Link from "next/link";

type IdeaCardProps = {
  idea: {
    id: string;
    title: string;
    summary: string;
    expandedExplanation: string;
    trajectory: string;
    noveltyStatus: string;
    overallScore: number;
    scoreExplanations: Record<string, string>;
  };
  canDispatch: boolean;
};

export function IdeaCard({ idea, canDispatch }: IdeaCardProps) {
  return (
    <section className="rounded-md border border-rf-border bg-rf-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-rf-violet">
            {idea.noveltyStatus.replaceAll("_", " ")}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-rf-white">{idea.title}</h3>
          <p className="mt-2 text-sm leading-6 text-rf-muted">{idea.summary}</p>
        </div>
        <div className="grid h-12 w-12 place-items-center rounded-md bg-rf-violet text-sm font-black text-white">
          {Math.round(idea.overallScore * 100)}
        </div>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-rf-white">
          Idea reasoning
        </summary>
        <div className="mt-3 grid gap-3 text-sm leading-6 text-rf-muted">
          <p>{idea.expandedExplanation}</p>
          <p>
            <strong className="text-rf-white">Trajectory:</strong> {idea.trajectory}
          </p>
          {Object.entries(idea.scoreExplanations).map(([key, value]) => (
            <p key={key}>
              <strong className="text-rf-white">{key}:</strong> {value}
            </p>
          ))}
        </div>
      </details>

      {canDispatch ? (
        <Link
          href={`/dispatch/${idea.id}`}
          className="mt-4 inline-flex rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-white"
        >
          Dispatch viability check
        </Link>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Implement PaperIdeaGroup**

Create `src/components/PaperIdeaGroup.tsx`:

```tsx
import { IdeaCard } from "@/components/IdeaCard";
import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";

type PaperIdeaGroupProps = {
  currentUserId: string;
  generatedForUserId: string;
  paper: {
    title: string;
    abstract: string;
    url: string;
    authors: string[];
    categories: string[];
    publishedAt: string;
  };
  ideas: Array<React.ComponentProps<typeof IdeaCard>["idea"]>;
};

export function PaperIdeaGroup({
  currentUserId,
  generatedForUserId,
  paper,
  ideas
}: PaperIdeaGroupProps) {
  const canDispatch = canDispatchIdeaForProfile({ currentUserId, generatedForUserId });

  return (
    <article className="rounded-lg border border-rf-border bg-rf-panel p-5">
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-rf-muted">
        <span>{paper.authors.slice(0, 3).join(", ")}</span>
        <span>arXiv</span>
        <span>{paper.publishedAt}</span>
        <span>{paper.categories.join(", ")}</span>
      </div>
      <h2 className="text-xl font-semibold text-rf-white">{paper.title}</h2>
      <p className="mt-2 text-sm leading-6 text-rf-muted">{paper.abstract}</p>
      <div className="mt-5 grid gap-3">
        {ideas.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} canDispatch={canDispatch} />
        ))}
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Wire inbox page to generated ideas**

Modify `src/app/(app)/inbox/[userId]/page.tsx` to call `getGeneratedInboxState`, group ideas by paper, and render pending/failed/ready states.

- [ ] **Step 5: Verify UI**

Run:

```powershell
npm test -- tests/paper-idea-group.test.tsx
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/components/PaperIdeaGroup.tsx src/components/IdeaCard.tsx src/app/(app)/inbox tests/paper-idea-group.test.tsx
git commit -m "feat: render ai generated inbox"
```

---

### Task 13: Add Profile Editor And Worker Setup Screens

**Files:**
- Create: `src/components/ProfileForm.tsx`
- Create: `src/app/(app)/profiles/[userId]/page.tsx`
- Create: `src/app/(app)/profiles/[userId]/actions.ts`
- Create: `src/app/(app)/workers/page.tsx`
- Create: `tests/profile-form.test.tsx`
- Create: `tests/worker-setup-page.test.tsx`

- [ ] **Step 1: Write profile form test**

Test that the form renders field preset, arXiv query, runtime limits, and related-work toggle.

- [ ] **Step 2: Implement profile form**

Create a server-action-backed form with these inputs:

```text
fieldPresetKey
keywords
preferredOutputs
constraints
arxivQuery
normalDailyRuntimeMin
maxDailyRuntimeMin
maxPapersScreened
maxPapersDeepRead
allowPdfFetch
allowRelatedWorkSearch
```

- [ ] **Step 3: Write worker page test**

Assert that the page shows:

```text
Connect my Codex worker
PowerShell setup command
Current worker status
Last seen timestamp
```

- [ ] **Step 4: Implement worker setup page**

The page should call the worker registration endpoint and display:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-worker.ps1 -AppUrl "<app-url>" -WorkerToken "<token>"
```

The token appears only immediately after registration.

- [ ] **Step 5: Verify**

Run:

```powershell
npm test -- tests/profile-form.test.tsx tests/worker-setup-page.test.tsx
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/components/ProfileForm.tsx src/app/(app)/profiles src/app/(app)/workers tests/profile-form.test.tsx tests/worker-setup-page.test.tsx
git commit -m "feat: add profile and worker setup screens"
```

---

### Task 14: Upgrade Dispatch To Generated Ideas And V2 Viability Jobs

**Files:**
- Modify: `src/lib/dispatch/service.ts`
- Create: `src/lib/jobs/viability.ts`
- Modify: `src/app/dispatch/[ideaId]/page.tsx`
- Modify: `src/app/dispatch/[ideaId]/actions.ts`
- Create: `tests/v2-dispatch-service.test.ts`

- [ ] **Step 1: Write dispatch permission tests**

Create `tests/v2-dispatch-service.test.ts` asserting:

```text
- user can dispatch own GeneratedIdea
- user cannot dispatch another user's GeneratedIdea
- created ViabilityJob has generatedIdeaId and queued status
```

- [ ] **Step 2: Make legacy idea relation optional**

Modify `prisma/schema.prisma` so `ViabilityJob` can point either at the legacy `Idea` model or the v2 `GeneratedIdea` model:

```prisma
model ViabilityJob {
  id             String   @id @default(cuid())
  userId         String
  ideaId         String?
  generatedIdeaId String?
  sprintDepth    String
  autonomyLevel  String
  status         String
  verdict        String?
  errorMessage   String?
  createdAt      DateTime @default(now())
  startedAt      DateTime?
  completedAt    DateTime?
  updatedAt      DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  idea Idea? @relation(fields: [ideaId], references: [id], onDelete: Cascade)
  generatedIdea GeneratedIdea? @relation(fields: [generatedIdeaId], references: [id], onDelete: Cascade)
  artifacts Artifact[]
  evidence Evidence[]
}
```

Run:

```powershell
npm run db:migrate -- --name optional_generated_viability_idea
```

Expected: Prisma creates a migration and `npm run db:generate` succeeds.

- [ ] **Step 3: Implement v2 viability job creation**

Create `src/lib/jobs/viability.ts`:

```ts
import { prisma } from "@/lib/db";
import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";

export async function createV2ViabilityJob(input: {
  currentUserId: string;
  generatedIdeaId: string;
}) {
  const idea = await prisma.generatedIdea.findUniqueOrThrow({
    where: { id: input.generatedIdeaId }
  });

  if (
    !canDispatchIdeaForProfile({
      currentUserId: input.currentUserId,
      generatedForUserId: idea.userId
    })
  ) {
    throw new Error("Cannot dispatch another user's generated idea");
  }

  return prisma.viabilityJob.create({
    data: {
      userId: input.currentUserId,
      generatedIdeaId: idea.id,
      sprintDepth: "default",
      autonomyLevel: "medium",
      status: "queued"
    }
  });
}
```

- [ ] **Step 4: Update dispatch UI**

Dispatch pages should load `GeneratedIdea` first and fall back to legacy `Idea` only for old demo routes. The primary v2 path uses `generatedIdeaId`.

- [ ] **Step 5: Verify**

Run:

```powershell
npm test -- tests/v2-dispatch-service.test.ts tests/dispatch-service.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations src/lib/jobs/viability.ts src/lib/dispatch/service.ts src/app/dispatch tests/v2-dispatch-service.test.ts
git commit -m "feat: dispatch generated ideas to viability"
```

---

### Task 15: Add Worker-Based Viability Completion

**Files:**
- Modify: `src/lib/jobs/viability.ts`
- Modify: `src/app/api/workers/claim/route.ts`
- Modify: `src/app/api/workers/jobs/[jobId]/complete/route.ts`
- Modify: `src/app/(app)/jobs/[jobId]/page.tsx`
- Create: `tests/v2-viability-worker.test.ts`

- [ ] **Step 1: Write worker viability tests**

Assert:

```text
- worker claims oldest queued viability job owned by its user
- worker upload validates ViabilityResultSchema
- verdict is one of expand, needs_novelty_check, revise, reject
- citations are persisted as Evidence rows
```

- [ ] **Step 2: Implement viability claim**

Add a `claimNextViabilityJob` function mirroring `claimNextInboxGenerationJob`, filtered by `userId` and `status = "queued"`.

- [ ] **Step 3: Implement viability completion**

Add:

```ts
import { ViabilityResultSchema } from "@/lib/v2/schemas";

export async function completeV2ViabilityJob(input: {
  jobId: string;
  workerId: string;
  output: unknown;
}) {
  const parsed = ViabilityResultSchema.parse(input.output);

  const job = await prisma.viabilityJob.findFirstOrThrow({
    where: {
      id: input.jobId,
      status: "running"
    }
  });

  await prisma.$transaction([
    prisma.evidence.createMany({
      data: parsed.citations.map((citation) => ({
        jobId: job.id,
        sourceTitle: citation.title,
        sourceUrl: citation.url,
        claim: citation.claim,
        support: parsed.summary,
        confidence: citation.confidence
      }))
    }),
    prisma.artifact.create({
      data: {
        jobId: job.id,
        kind: "viability-report",
        title: `Viability result: ${parsed.verdict}`,
        content: JSON.stringify(parsed, null, 2)
      }
    }),
    prisma.viabilityJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        verdict: parsed.verdict,
        completedAt: new Date()
      }
    })
  ]);
}
```

- [ ] **Step 4: Render verdict page**

Update `src/app/(app)/jobs/[jobId]/page.tsx` to render the four v2 verdicts and evidence list.

- [ ] **Step 5: Verify**

Run:

```powershell
npm test -- tests/v2-viability-worker.test.ts tests/viability-service.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/jobs/viability.ts src/app/api/workers src/app/(app)/jobs tests/v2-viability-worker.test.ts
git commit -m "feat: complete viability jobs from worker"
```

---

### Task 16: Remove Legacy Private Token Gate From Main UX

**Files:**
- Modify: `src/lib/private-access.ts`
- Modify: `src/lib/private-access-server.ts`
- Modify: `src/app/inbox/[userId]/page.tsx`
- Modify: `README.md`
- Modify: `tests/private-access.test.ts`

- [ ] **Step 1: Remove the legacy private-access path**

Remove the old query-token private access helpers after all routes use Google auth:

```text
src/lib/private-access.ts
src/lib/private-access-server.ts
tests/private-access.test.ts
```

- [ ] **Step 2: Remove old route group**

After `(app)` routes replace old pages, remove:

```text
src/app/inbox/[userId]/page.tsx
src/lib/private-access.ts
src/lib/private-access-server.ts
tests/private-access.test.ts
```

- [ ] **Step 3: Update README**

Replace query-token instructions with:

```text
Authentication is handled by Google sign-in. Set ALLOWED_GOOGLE_EMAILS to the two allowed accounts. Worker setup is available from /workers after signing in.
```

- [ ] **Step 4: Verify**

Run:

```powershell
rg "APP_ACCESS_TOKENS|accessToken|private-access"
npm test
npm run lint
npm run build
```

Expected: `rg` finds no live app references. Tests, lint, and build pass.

- [ ] **Step 5: Commit**

```powershell
git add README.md src tests
git commit -m "refactor: remove legacy private token gate"
```

---

### Task 17: Final V2 Verification And Deployment Notes

**Files:**
- Modify: `README.md`
- Create: `docs/deployment.md`

- [ ] **Step 1: Add deployment docs**

Create `docs/deployment.md`:

```md
# ResearchFinder Deployment

## Required Services

- Next.js hosting
- Postgres database
- Google OAuth client
- Hosted cron that calls `POST /api/cron/candidates`

## Environment Variables

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ALLOWED_GOOGLE_EMAILS`
- `CRON_SECRET`
- `WORKER_TOKEN_SECRET`

## Database

Use Prisma migrations for deployed databases:

```powershell
npm run db:deploy
```

Use migration development only against a development database:

```powershell
npm run db:migrate
```

## Worker Setup

Sign in, open `/workers`, create a worker token, and run the displayed PowerShell installer once on the Windows machine that should run Codex jobs.
```

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected:

```text
All tests pass.
ESLint exits 0.
Next production build exits 0.
```

- [ ] **Step 3: Commit docs**

```powershell
git add README.md docs/deployment.md
git commit -m "docs: add hosted deployment guide"
```

---

## Execution Notes

- Start execution from a worktree created with `superpowers:using-git-worktrees`.
- Use TDD for each service boundary: write the test, verify it fails, implement, verify pass, then commit.
- Commit after every task. Do not batch multiple tasks into one commit.
- Keep legacy `Idea`/`InboxItem` code only until generated inbox pages and dispatch are fully migrated.
- Do not add Claude Code support in this implementation.
- Do not add non-arXiv sources in this implementation.
- Do not implement full research sprint or paper-writing actions in this implementation.

## Self-Review Checklist

- Spec coverage: tasks cover Postgres, Google allowlist auth, separate profiles, shared visibility, dispatch ownership, arXiv-only candidate jobs, AI inbox jobs, Windows worker setup, Codex runner boundary, rich idea UI, citation persistence, no heuristic fallback, and v2 viability verdicts.
- Type consistency: v2 job types use `inbox_generation` and `viability_check`; v2 verdicts use `expand`, `needs_novelty_check`, `revise`, and `reject`; novelty states use `verified`, `needs_novelty_check`, and `not_novel`.
- Risk controls: worker tokens are hashed, Codex credentials stay local, malformed worker output is rejected by Zod, and jobs are claimed with status-guarded updates.
