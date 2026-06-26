# Worker Lanes & Multi-Worker Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user run multiple, lane-scoped local workers (so a long research job can never block the daily inbox) and see, per worker, what it is running now and what it just did.

**Architecture:** Add a `lane` to `WorkerRegistration`; the claim route filters claim attempts by lane (worker binary unchanged). A read model unions the four job tables for a worker's live "current job" and reads the (newly activated) `WorkerJobLog` for history; a live dashboard renders all workers. Creating a worker picks a lane and emits an install command with a unique scheduled-task name so workers coexist.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Prisma/Postgres, Vitest + Testing Library, PowerShell install script.

**Reference spec:** `docs/superpowers/specs/2026-06-26-worker-lanes-and-dashboard-design.md`

**Postgres test command (bash, inline env — the `.env` `TEST_DATABASE_URL` points at the unused port 54329; override to 5432):**
```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/<file> --no-file-parallelism --testTimeout 60000
```
Postgres-backed tests run `prisma db push` from `prisma/schema.prisma`, so updating the schema (Task 2) is enough for tests; the migration SQL is for prod deploy. Pure (non-DB) tests use plain `npm test -- tests/<file>`.

**Commit convention:** end every commit message body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/v2/domain.ts` | Enums/constants | Add `WORKER_LANES`, `WorkerLane` |
| `src/lib/workers/lanes.ts` | Lane → job-type mapping | Create |
| `prisma/schema.prisma` | DB model | Add `lane` to `WorkerRegistration` |
| `prisma/migrations/20260626120000_worker_lane/migration.sql` | Prod migration | Create |
| `src/lib/auth/worker-token.ts` | Token → worker | Return `lane` |
| `src/app/api/workers/claim/route.ts` | Claim | Lane-gated, flattened |
| `src/lib/workers/status.ts` | Online window | Export `ONLINE_WINDOW_MS` |
| `src/lib/workers/overview.ts` | Read model | Create (`getWorkersOverviewForUser`, `deriveWorkerStatus`, `buildWorkerJobTargetLabel`) |
| `src/lib/workers/job-log.ts` | Activity writer | Create (`recordWorkerJobLog`) |
| `src/app/api/workers/jobs/[jobId]/complete/route.ts` | Completion | Write `WorkerJobLog` on success + failure |
| `src/app/workers/actions.ts` | Server actions | Add `getWorkersOverview`; lane in `registerWorker` |
| `src/lib/jobs/worker-registration.ts` | Registration | Accept `lane` |
| `src/components/WorkersOverviewLive.tsx` | Dashboard | Create |
| `src/components/WorkerSetupContent.tsx` | Setup + dashboard host | Lane select; task name; host overview |
| `src/app/workers/page.tsx` | Page | Feed overview |
| `scripts/install-worker.ps1` | Installer | `-TaskName` param, per-worker install dir |
| Tests | see each task | Create |

---

## Task 1: Lane constants + lane→job-type helper

**Files:**
- Modify: `src/lib/v2/domain.ts`
- Create: `src/lib/workers/lanes.ts`
- Test: `tests/worker-lanes.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/worker-lanes.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { laneClaimsJobType, LANE_JOB_TYPES } from "@/lib/workers/lanes";

describe("laneClaimsJobType", () => {
  it("inbox lane claims only inbox_generation and novelty_scan", () => {
    expect(laneClaimsJobType("inbox", "inbox_generation")).toBe(true);
    expect(laneClaimsJobType("inbox", "novelty_scan")).toBe(true);
    expect(laneClaimsJobType("inbox", "viability_check")).toBe(false);
    expect(laneClaimsJobType("inbox", "research_plan")).toBe(false);
  });

  it("research lane claims only viability_check and research_plan", () => {
    expect(laneClaimsJobType("research", "inbox_generation")).toBe(false);
    expect(laneClaimsJobType("research", "novelty_scan")).toBe(false);
    expect(laneClaimsJobType("research", "viability_check")).toBe(true);
    expect(laneClaimsJobType("research", "research_plan")).toBe(true);
  });

  it("both lane claims everything", () => {
    expect(laneClaimsJobType("both", "inbox_generation")).toBe(true);
    expect(laneClaimsJobType("both", "research_plan")).toBe(true);
  });

  it("an unknown/legacy lane value behaves like both", () => {
    expect(laneClaimsJobType("garbage", "inbox_generation")).toBe(true);
    expect(laneClaimsJobType("garbage", "research_plan")).toBe(true);
  });

  it("LANE_JOB_TYPES.both lists all four job types", () => {
    expect([...LANE_JOB_TYPES.both].sort()).toEqual(
      ["inbox_generation", "novelty_scan", "research_plan", "viability_check"]
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
npm test -- tests/worker-lanes.test.ts
```
Expected: FAIL — `@/lib/workers/lanes` does not exist.

- [ ] **Step 3: Add the domain constant** — append to `src/lib/v2/domain.ts`:

```ts
export const WORKER_LANES = ["inbox", "research", "both"] as const;
export type WorkerLane = (typeof WORKER_LANES)[number];
```

- [ ] **Step 4: Create `src/lib/workers/lanes.ts`:**

```ts
import type { WorkerLane } from "@/lib/v2/domain";

export const WORKER_JOB_TYPES = [
  "inbox_generation",
  "novelty_scan",
  "viability_check",
  "research_plan"
] as const;
export type WorkerJobType = (typeof WORKER_JOB_TYPES)[number];

export const LANE_JOB_TYPES: Record<WorkerLane, readonly WorkerJobType[]> = {
  inbox: ["inbox_generation", "novelty_scan"],
  research: ["viability_check", "research_plan"],
  both: ["inbox_generation", "novelty_scan", "viability_check", "research_plan"]
};

// `lane` is a free-form String column; an unrecognized value (e.g. a future
// lane or legacy data) defaults to `both`, preserving today's claim-everything
// behavior rather than silently starving a worker.
export function laneClaimsJobType(lane: string, jobType: WorkerJobType): boolean {
  const allowed = LANE_JOB_TYPES[lane as WorkerLane] ?? LANE_JOB_TYPES.both;
  return allowed.includes(jobType);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```
npm test -- tests/worker-lanes.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/v2/domain.ts src/lib/workers/lanes.ts tests/worker-lanes.test.ts
git commit -m "feat: add worker lane constants and lane job-type mapping"
```

---

## Task 2: Prisma `lane` field + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260626120000_worker_lane/migration.sql`

- [ ] **Step 1: Add the field** — in `prisma/schema.prisma`, in `model WorkerRegistration`, add the `lane` field right after `status`:

```prisma
model WorkerRegistration {
  id         String    @id @default(cuid())
  userId     String
  label      String
  tokenHash  String
  status     String
  lane       String    @default("both")
  lastSeenAt DateTime?
  createdAt  DateTime  @default(now())
  revokedAt  DateTime?

  user User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  logs WorkerJobLog[]

  @@index([userId, status])
}
```

- [ ] **Step 2: Validate + regenerate the client**

```
npx prisma validate
npx prisma generate
```
Expected: both succeed.

- [ ] **Step 3: Hand-author the migration** — create `prisma/migrations/20260626120000_worker_lane/migration.sql` (UTF-8, **no BOM** — a prior migration BOM caused a bug):

```sql
-- AlterTable
ALTER TABLE "WorkerRegistration" ADD COLUMN "lane" TEXT NOT NULL DEFAULT 'both';
```

After writing it, verify no BOM: `head -c 3 prisma/migrations/20260626120000_worker_lane/migration.sql | xxd` (first bytes must NOT be `ef bb bf`).

- [ ] **Step 4: Confirm the schema pushes cleanly**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/prisma-schema-shape.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS (proves the altered model pushes without error).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260626120000_worker_lane/migration.sql
git commit -m "feat: add lane column to worker registration"
```

---

## Task 3: Lane-aware claim route

**Files:**
- Modify: `src/lib/auth/worker-token.ts`
- Modify: `src/app/api/workers/claim/route.ts`
- Test: `tests/worker-lane-claim.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/worker-lane-claim.test.ts` (Postgres-backed; drives the real claim route with a mocked worker so the lane is controlled by the test):

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

async function seedResearchPlanJob(client: PrismaClient, userId: string) {
  const paper = await client.paper.create({
    data: {
      arxivId: "2503.00003",
      title: "Src",
      abstract: "A",
      url: "https://arxiv.org/abs/2503.00003",
      publishedAt: new Date(),
      arxivUpdatedAt: new Date(),
      authorsJson: "[]",
      categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId, paperId: paper.id, inboxDate: "2026-06-26",
      title: "T", summary: "S", expandedExplanation: "E", trajectory: "Tr",
      recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8,
      feasibilityScore: 0.8, overallScore: 0.8, scoreExplanationsJson: "{}",
      risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  await client.researchPlanJob.create({
    data: {
      researchProjectId: project.id, userId, status: "queued",
      inputJson: JSON.stringify({ researchProjectId: project.id })
    }
  });
}

async function postClaim() {
  const { POST } = await import("@/app/api/workers/claim/route");
  const response = await POST(
    new Request("http://localhost/api/workers/claim", {
      method: "POST",
      headers: { authorization: "Bearer t" }
    })
  );
  return (await response.json()) as { job: { type: string } | null };
}

describe("lane-aware claim", () => {
  it("an inbox-lane worker does NOT claim a queued research_plan job", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "inbox-lane@example.com" } });
      await client.workerRegistration.create({
        data: { userId: user.id, label: "w", tokenHash: "h", status: "active", lane: "inbox" }
      });
      mocked.worker = { id: "w-inbox", userId: user.id, lane: "inbox" };
      await seedResearchPlanJob(client, user.id);

      const payload = await postClaim();
      expect(payload.job).toBeNull();
    });
  });

  it("a research-lane worker claims the queued research_plan job", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "research-lane@example.com" } });
      mocked.worker = { id: "w-research", userId: user.id, lane: "research" };
      await seedResearchPlanJob(client, user.id);

      const payload = await postClaim();
      expect(payload.job?.type).toBe("research_plan");
    });
  });

  it("a both-lane worker claims the queued research_plan job", async () => {
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "both-lane@example.com" } });
      mocked.worker = { id: "w-both", userId: user.id, lane: "both" };
      await seedResearchPlanJob(client, user.id);

      const payload = await postClaim();
      expect(payload.job?.type).toBe("research_plan");
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-lane-claim.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — the inbox-lane case still claims research_plan (no lane gating yet).

- [ ] **Step 3: Return `lane` from the token lookup** — in `src/lib/auth/worker-token.ts`, add `lane: true` to the `select` and include it in the returned object:

```ts
export async function findAllowedWorkerByToken(token: string) {
  const workers = await prisma.workerRegistration.findMany({
    where: {
      status: "active",
      revokedAt: null
    },
    select: {
      id: true,
      userId: true,
      lane: true,
      tokenHash: true,
      user: { select: { email: true } }
    }
  });

  for (const worker of workers) {
    if (await verifyWorkerToken(token, worker.tokenHash)) {
      return isAllowedGoogleEmail(worker.user.email)
        ? { id: worker.id, userId: worker.userId, lane: worker.lane }
        : null;
    }
  }

  return null;
}
```

- [ ] **Step 4: Flatten + lane-gate the claim route** — replace the entire `POST` function in `src/app/api/workers/claim/route.ts` with this (the helper functions `parseJsonArray`, `formatErrorMessage`, `buildNoveltyScanJobInput`, `buildResearchPlanJobInput`, `buildViabilityJobInput` below it are unchanged):

```ts
export async function POST(request: Request) {
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

  const lane = worker.lane;

  if (laneClaimsJobType(lane, "inbox_generation")) {
    const job = await claimNextInboxGenerationJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (job) {
      try {
        if (!job.user.profile) {
          throw new Error("Worker user has no research profile");
        }

        const input: InboxGenerationJobInput = InboxGenerationJobInputSchema.parse({
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
            arxivQuery: job.user.profile.arxivQuery,
            maxIdeas: MAX_DAILY_IDEAS,
            maxIdeasPerPaper: MAX_IDEAS_PER_PAPER
          },
          candidatePapers: job.candidateBatch.candidates.map((candidate) => ({
            sourceId: candidate.arxivId,
            title: candidate.title,
            abstract: candidate.abstract,
            url: candidate.url,
            authors: parseJsonArray(candidate.authorsJson, "authorsJson"),
            categories: parseJsonArray(candidate.categoriesJson, "categoriesJson"),
            publishedAt: candidate.publishedAt.toISOString()
          }))
        });

        return NextResponse.json({ job: { type: "inbox_generation", id: job.id, input } });
      } catch (error) {
        await prisma.inboxGenerationJob.update({
          where: { id: job.id },
          data: { status: "failed", errorMessage: formatErrorMessage(error), completedAt: new Date() }
        });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
  }

  if (laneClaimsJobType(lane, "novelty_scan")) {
    const noveltyJob = await claimNextNoveltyScanJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (noveltyJob) {
      try {
        return NextResponse.json({
          job: { type: "novelty_scan", id: noveltyJob.id, input: buildNoveltyScanJobInput(noveltyJob) }
        });
      } catch (error) {
        await prisma.inboxNoveltyScanJob.update({
          where: { id: noveltyJob.id },
          data: { status: "failed", errorMessage: formatErrorMessage(error), completedAt: new Date() }
        });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
  }

  if (laneClaimsJobType(lane, "viability_check")) {
    const viabilityJob = await claimNextViabilityJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (viabilityJob) {
      try {
        return NextResponse.json({
          job: { type: "viability_check", id: viabilityJob.id, input: buildViabilityJobInput(viabilityJob) }
        });
      } catch (error) {
        await prisma.viabilityJob.update({
          where: { id: viabilityJob.id },
          data: { status: "failed", errorMessage: formatErrorMessage(error), completedAt: new Date() }
        });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
  }

  if (laneClaimsJobType(lane, "research_plan")) {
    const researchPlanJob = await claimNextResearchPlanJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (researchPlanJob) {
      try {
        return NextResponse.json({
          job: {
            type: "research_plan",
            id: researchPlanJob.id,
            input: await buildResearchPlanJobInput(researchPlanJob)
          }
        });
      } catch (error) {
        await failResearchPlanJob({ jobId: researchPlanJob.id, errorMessage: formatErrorMessage(error) });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ job: null });
}
```

- [ ] **Step 5: Add the import** — at the top of `src/app/api/workers/claim/route.ts`, add:

```ts
import { laneClaimsJobType } from "@/lib/workers/lanes";
```

- [ ] **Step 6: Run the new test + the existing worker-route tests**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-lane-claim.test.ts tests/research-worker-routes.test.ts tests/worker-claim-route.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS. (The existing `research-worker-routes` / `worker-claim-route` tests must update their `mocked.worker` to include `lane`. If they fail because the mocked worker lacks `lane`, set `lane: "both"` on those mocks — see Step 7.)

- [ ] **Step 7: Fix existing worker-route test mocks if needed** — if `tests/research-worker-routes.test.ts` or `tests/worker-claim-route.test.ts` set `mocked.worker = { id, userId }`, add `lane: "both"` so they exercise the unchanged "claims everything" path. Re-run Step 6 until green. Also run typecheck:

```
npx tsc --noEmit --pretty false
```
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/worker-token.ts "src/app/api/workers/claim/route.ts" tests/worker-lane-claim.test.ts tests/research-worker-routes.test.ts tests/worker-claim-route.test.ts
git commit -m "feat: gate worker claims by lane"
```

---

## Task 4: Worker overview read model

**Files:**
- Modify: `src/lib/workers/status.ts`
- Create: `src/lib/workers/overview.ts`
- Test: `tests/worker-overview.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/worker-overview.test.ts`:

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

async function seedRunningResearchPlan(client: PrismaClient, userId: string, workerId: string) {
  const paper = await client.paper.create({
    data: {
      arxivId: "2504.00004", title: "Src", abstract: "A",
      url: "https://arxiv.org/abs/2504.00004", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId, paperId: paper.id, inboxDate: "2026-06-26",
      title: "ProbeCraft", summary: "S", expandedExplanation: "E", trajectory: "Tr",
      recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8,
      feasibilityScore: 0.8, overallScore: 0.8, scoreExplanationsJson: "{}",
      risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  await client.researchPlanJob.create({
    data: {
      researchProjectId: project.id, userId, status: "running",
      claimedByWorkerId: workerId, startedAt: new Date(),
      inputJson: JSON.stringify({ researchProjectId: project.id })
    }
  });
}

describe("getWorkersOverviewForUser", () => {
  it("reports an online worker with its current job and recent history", async () => {
    const { getWorkersOverviewForUser } = await import("@/lib/workers/overview");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "overview@example.com" } });
      const worker = await client.workerRegistration.create({
        data: {
          userId: user.id, label: "Codex worker", tokenHash: "h",
          status: "active", lane: "research", lastSeenAt: new Date()
        }
      });
      await seedRunningResearchPlan(client, user.id, worker.id);
      await client.workerJobLog.create({
        data: { workerId: worker.id, jobType: "research_plan", jobId: "old", level: "completed", message: "Completed research_plan for \"Prior\"" }
      });

      const overview = await getWorkersOverviewForUser(user.id);
      expect(overview).toHaveLength(1);
      const row = overview[0];
      expect(row.lane).toBe("research");
      expect(row.status).toBe("online");
      expect(row.currentJobs).toHaveLength(1);
      expect(row.currentJobs[0].jobType).toBe("research_plan");
      expect(row.currentJobs[0].targetLabel).toBe("ProbeCraft");
      expect(row.recentLogs).toHaveLength(1);
      expect(row.recentLogs[0].level).toBe("completed");
    });
  });

  it("reports offline when lastSeenAt is stale and excludes revoked workers", async () => {
    const { getWorkersOverviewForUser } = await import("@/lib/workers/overview");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "offline@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id, label: "Stale", tokenHash: "h", status: "active", lane: "both",
          lastSeenAt: new Date(Date.now() - 10 * 60 * 1000)
        }
      });
      await client.workerRegistration.create({
        data: {
          userId: user.id, label: "Gone", tokenHash: "h2", status: "active", lane: "both",
          lastSeenAt: new Date(), revokedAt: new Date()
        }
      });

      const overview = await getWorkersOverviewForUser(user.id);
      expect(overview).toHaveLength(1);
      expect(overview[0].label).toBe("Stale");
      expect(overview[0].status).toBe("offline");
      expect(overview[0].currentJobs).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-overview.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — `@/lib/workers/overview` does not exist.

- [ ] **Step 3: Export the online window** — in `src/lib/workers/status.ts`, change the const to be exported:

```ts
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
```
(Leave the rest of the file unchanged.)

- [ ] **Step 4: Create `src/lib/workers/overview.ts`:**

```ts
import type { WorkerStatus } from "@/components/WorkerStatusPanel";
import { prisma } from "@/lib/db";
import type { WorkerJobType } from "@/lib/workers/lanes";
import { ONLINE_WINDOW_MS } from "@/lib/workers/status";

export type WorkerCurrentJob = {
  jobType: WorkerJobType;
  jobId: string;
  targetLabel: string;
  startedAt: Date | null;
};

export type WorkerActivityLog = {
  id: string;
  jobType: string;
  level: string;
  message: string;
  createdAt: Date;
};

export type WorkerOverviewRow = {
  id: string;
  label: string;
  lane: string;
  status: WorkerStatus;
  lastSeenAt: Date | null;
  createdAt: Date;
  currentJobs: WorkerCurrentJob[];
  recentLogs: WorkerActivityLog[];
};

export function deriveWorkerStatus(worker: { status: string; lastSeenAt: Date | null }): WorkerStatus {
  if (worker.status === "needs_auth") return "needs_auth";
  if (worker.lastSeenAt && Date.now() - worker.lastSeenAt.getTime() <= ONLINE_WINDOW_MS) {
    return "online";
  }
  return "offline";
}

export async function buildWorkerJobTargetLabel(jobType: WorkerJobType, jobId: string): Promise<string> {
  if (jobType === "inbox_generation") {
    const job = await prisma.inboxGenerationJob.findUnique({
      where: { id: jobId },
      select: { inboxDate: true }
    });
    return job?.inboxDate ?? jobId;
  }

  if (jobType === "novelty_scan") {
    const job = await prisma.inboxNoveltyScanJob.findUnique({
      where: { id: jobId },
      select: { inboxDate: true }
    });
    return job?.inboxDate ?? jobId;
  }

  if (jobType === "viability_check") {
    const job = await prisma.viabilityJob.findUnique({
      where: { id: jobId },
      select: { generatedIdea: { select: { title: true } }, idea: { select: { title: true } } }
    });
    return job?.generatedIdea?.title ?? job?.idea?.title ?? jobId;
  }

  const job = await prisma.researchPlanJob.findUnique({
    where: { id: jobId },
    select: { researchProject: { select: { generatedIdea: { select: { title: true } } } } }
  });
  return job?.researchProject?.generatedIdea?.title ?? jobId;
}

async function getRunningJobsForWorker(workerId: string): Promise<WorkerCurrentJob[]> {
  const [inbox, novelty, viability, research] = await Promise.all([
    prisma.inboxGenerationJob.findMany({
      where: { claimedByWorkerId: workerId, status: "running" },
      select: { id: true, startedAt: true }
    }),
    prisma.inboxNoveltyScanJob.findMany({
      where: { claimedByWorkerId: workerId, status: "running" },
      select: { id: true, startedAt: true }
    }),
    prisma.viabilityJob.findMany({
      where: { claimedByWorkerId: workerId, status: "running" },
      select: { id: true, startedAt: true }
    }),
    prisma.researchPlanJob.findMany({
      where: { claimedByWorkerId: workerId, status: "running" },
      select: { id: true, startedAt: true }
    })
  ]);

  const rows: { jobType: WorkerJobType; id: string; startedAt: Date | null }[] = [
    ...inbox.map((j) => ({ jobType: "inbox_generation" as const, id: j.id, startedAt: j.startedAt })),
    ...novelty.map((j) => ({ jobType: "novelty_scan" as const, id: j.id, startedAt: j.startedAt })),
    ...viability.map((j) => ({ jobType: "viability_check" as const, id: j.id, startedAt: j.startedAt })),
    ...research.map((j) => ({ jobType: "research_plan" as const, id: j.id, startedAt: j.startedAt }))
  ];

  return Promise.all(
    rows.map(async (r) => ({
      jobType: r.jobType,
      jobId: r.id,
      startedAt: r.startedAt,
      targetLabel: await buildWorkerJobTargetLabel(r.jobType, r.id)
    }))
  );
}

export async function getWorkersOverviewForUser(userId: string): Promise<WorkerOverviewRow[]> {
  const workers = await prisma.workerRegistration.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, lane: true, status: true, lastSeenAt: true, createdAt: true }
  });

  return Promise.all(
    workers.map(async (worker) => {
      const [currentJobs, recentLogs] = await Promise.all([
        getRunningJobsForWorker(worker.id),
        prisma.workerJobLog.findMany({
          where: { workerId: worker.id },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, jobType: true, level: true, message: true, createdAt: true }
        })
      ]);

      return {
        id: worker.id,
        label: worker.label,
        lane: worker.lane,
        status: deriveWorkerStatus(worker),
        lastSeenAt: worker.lastSeenAt,
        createdAt: worker.createdAt,
        currentJobs,
        recentLogs
      };
    })
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-overview.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workers/status.ts src/lib/workers/overview.ts tests/worker-overview.test.ts
git commit -m "feat: add worker overview read model"
```

---

## Task 5: WorkerJobLog writer + completion wiring

**Files:**
- Create: `src/lib/workers/job-log.ts`
- Modify: `src/app/api/workers/jobs/[jobId]/complete/route.ts`
- Test: `tests/worker-job-log.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/worker-job-log.test.ts`:

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

async function seedResearchPlanRow(client: PrismaClient, userId: string) {
  const paper = await client.paper.create({
    data: {
      arxivId: "2505.00005", title: "Src", abstract: "A",
      url: "https://arxiv.org/abs/2505.00005", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId, paperId: paper.id, inboxDate: "2026-06-26",
      title: "Stuck idea", summary: "S", expandedExplanation: "E", trajectory: "Tr",
      recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8,
      feasibilityScore: 0.8, overallScore: 0.8, scoreExplanationsJson: "{}",
      risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  return client.researchPlanJob.create({
    data: {
      researchProjectId: project.id, userId, status: "running",
      claimedByWorkerId: "w1", startedAt: new Date(),
      inputJson: JSON.stringify({ researchProjectId: project.id })
    }
  });
}

describe("recordWorkerJobLog", () => {
  it("writes a completed log row with the target label in the message", async () => {
    const { recordWorkerJobLog } = await import("@/lib/workers/job-log");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "log@example.com" } });
      const job = await seedResearchPlanRow(client, user.id);

      await recordWorkerJobLog({
        workerId: "w1", jobType: "research_plan", jobId: job.id, level: "completed"
      });

      const logs = await client.workerJobLog.findMany({ where: { workerId: "w1" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("completed");
      expect(logs[0].message).toContain("Stuck idea");
    });
  });

  it("is best-effort: a missing job does not throw and still records a row", async () => {
    const { recordWorkerJobLog } = await import("@/lib/workers/job-log");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      await expect(
        recordWorkerJobLog({
          workerId: "w1", jobType: "research_plan", jobId: "does-not-exist", level: "failed", errorMessage: "boom"
        })
      ).resolves.toBeUndefined();
      const logs = await client.workerJobLog.findMany({ where: { workerId: "w1" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("failed");
      expect(logs[0].message).toContain("boom");
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-job-log.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — `@/lib/workers/job-log` does not exist.

- [ ] **Step 3: Create `src/lib/workers/job-log.ts`:**

```ts
import { prisma } from "@/lib/db";
import type { WorkerJobType } from "@/lib/workers/lanes";
import { buildWorkerJobTargetLabel } from "@/lib/workers/overview";

export async function recordWorkerJobLog(input: {
  workerId: string;
  jobType: WorkerJobType;
  jobId: string;
  level: "completed" | "failed";
  errorMessage?: string;
}): Promise<void> {
  try {
    const targetLabel = await buildWorkerJobTargetLabel(input.jobType, input.jobId);
    const verb = input.level === "completed" ? "Completed" : "Failed";
    const suffix = input.level === "failed" && input.errorMessage ? ` — ${input.errorMessage}` : "";
    const message = `${verb} ${input.jobType} for "${targetLabel}"${suffix}`;

    await prisma.workerJobLog.create({
      data: {
        workerId: input.workerId,
        jobType: input.jobType,
        jobId: input.jobId,
        level: input.level,
        message
      }
    });
  } catch {
    // Best-effort: activity logging must never break job completion/failure handling.
  }
}
```

- [ ] **Step 4: Run the writer test to verify it passes**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-job-log.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 5: Wire it into the completion route** — in `src/app/api/workers/jobs/[jobId]/complete/route.ts`:

Add the import:
```ts
import { recordWorkerJobLog } from "@/lib/workers/job-log";
```

Add a success log just before the final `return NextResponse.json({ ok: true });` at the end of `POST` (after the `try/catch` that runs the completion):
```ts
  await recordWorkerJobLog({ workerId: worker.id, jobType, jobId, level: "completed" });

  return NextResponse.json({ ok: true });
```

Replace `markWorkerJobFailed` with this version (early `return`s become `if/else if` so a single log call runs for every failure path):
```ts
async function markWorkerJobFailed(input: {
  jobId: string;
  workerId: string;
  jobType: WorkerJobType;
  errorMessage: string;
}) {
  const where = {
    id: input.jobId,
    claimedByWorkerId: input.workerId,
    status: "running"
  };
  const data = {
    status: "failed",
    errorMessage: input.errorMessage,
    completedAt: new Date()
  };

  if (input.jobType === "inbox_generation") {
    await prisma.inboxGenerationJob.updateMany({ where, data });
  } else if (input.jobType === "novelty_scan") {
    await prisma.inboxNoveltyScanJob.updateMany({ where, data });
  } else if (input.jobType === "research_plan") {
    await failResearchPlanJob({ jobId: input.jobId, errorMessage: input.errorMessage });
  } else {
    await prisma.viabilityJob.updateMany({ where, data });
  }

  await recordWorkerJobLog({
    workerId: input.workerId,
    jobType: input.jobType,
    jobId: input.jobId,
    level: "failed",
    errorMessage: input.errorMessage
  });
}
```

- [ ] **Step 6: Add a route-level failure test** — append to `tests/worker-job-log.test.ts` a case that drives the real complete route's failure path (it mocks `@/lib/auth/worker-token`, so add that mock at the top of the file alongside the existing `@/lib/db` mock):

Add near the top mocks:
```ts
const mockedWorker = vi.hoisted(() => ({ worker: null as { id: string; userId: string; lane: string } | null }));
vi.mock("@/lib/auth/worker-token", () => ({
  findAllowedWorkerByToken: async () => mockedWorker.worker
}));
```
Add inside `afterEach`: `mockedWorker.worker = null;`

Add this test:
```ts
  it("the completion route records a failed log when the worker reports an error", async () => {
    const { POST } = await import("@/app/api/workers/jobs/[jobId]/complete/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "route-fail@example.com" } });
      const worker = await client.workerRegistration.create({
        data: { userId: user.id, label: "w", tokenHash: "h", status: "active", lane: "research", lastSeenAt: new Date() }
      });
      const job = await seedResearchPlanRow(client, user.id);
      await client.researchPlanJob.update({ where: { id: job.id }, data: { claimedByWorkerId: worker.id } });
      mockedWorker.worker = { id: worker.id, userId: user.id, lane: "research" };

      const response = await POST(
        new Request(`http://localhost/api/workers/jobs/${job.id}/complete`, {
          method: "POST",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify({ type: "research_plan", error: "codex crashed" })
        }),
        { params: Promise.resolve({ jobId: job.id }) }
      );
      expect(response.status).toBe(200);

      const failed = await client.researchPlanJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(failed.status).toBe("failed");
      const logs = await client.workerJobLog.findMany({ where: { workerId: worker.id } });
      expect(logs.some((l) => l.level === "failed" && l.message.includes("codex crashed"))).toBe(true);
    });
  });
```
(Note `seedResearchPlanRow` sets `claimedByWorkerId: "w1"`; this test re-points it to the real `worker.id` so `resolveJobType` and `markWorkerJobFailed`'s `where` match.)

- [ ] **Step 7: Run the full job-log test file + typecheck**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-job-log.test.ts --no-file-parallelism --testTimeout 60000
npx tsc --noEmit --pretty false
```
Expected: PASS and exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/workers/job-log.ts "src/app/api/workers/jobs/[jobId]/complete/route.ts" tests/worker-job-log.test.ts
git commit -m "feat: record worker job activity log on completion and failure"
```

---

## Task 6: Multi-worker dashboard UI

**Files:**
- Modify: `src/app/workers/actions.ts`
- Create: `src/components/WorkersOverviewLive.tsx`
- Modify: `src/components/WorkerSetupContent.tsx`
- Modify: `src/app/workers/page.tsx`
- Test: `tests/workers-overview-live.test.tsx` (create)

- [ ] **Step 1: Write the failing test** — create `tests/workers-overview-live.test.tsx`:

```tsx
import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkersOverviewLive } from "@/components/WorkersOverviewLive";
import type { WorkerOverviewRow } from "@/lib/workers/overview";

function row(overrides: Partial<WorkerOverviewRow>): WorkerOverviewRow {
  return {
    id: "w1", label: "Codex worker", lane: "research", status: "online",
    lastSeenAt: new Date(), createdAt: new Date(), currentJobs: [], recentLogs: [],
    ...overrides
  };
}

describe("WorkersOverviewLive", () => {
  it("renders each worker with its lane and current job", () => {
    const initial: WorkerOverviewRow[] = [
      row({
        id: "w1", label: "Codex worker", lane: "research", status: "online",
        currentJobs: [{ jobType: "research_plan", jobId: "j1", targetLabel: "ProbeCraft", startedAt: new Date() }]
      }),
      row({ id: "w2", label: "Inbox worker", lane: "inbox", status: "online", currentJobs: [] })
    ];
    render(<WorkersOverviewLive initialWorkers={initial} overviewAction={vi.fn()} />);

    expect(screen.getByText("Codex worker")).toBeInTheDocument();
    expect(screen.getByText("Inbox worker")).toBeInTheDocument();
    expect(screen.getByText("ProbeCraft")).toBeInTheDocument();
    expect(screen.getByText(/research_plan/)).toBeInTheDocument();
    // inbox worker has no current job
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("shows an empty state when there are no workers", () => {
    render(<WorkersOverviewLive initialWorkers={[]} overviewAction={vi.fn()} />);
    expect(screen.getByText(/No workers registered/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
npm test -- tests/workers-overview-live.test.tsx
```
Expected: FAIL — `@/components/WorkersOverviewLive` does not exist.

- [ ] **Step 3: Add the overview server action** — in `src/app/workers/actions.ts`, add (keep the existing `registerWorker` and `getCurrentWorkerStatus`):

```ts
import { getWorkersOverviewForUser, type WorkerOverviewRow } from "@/lib/workers/overview";
```
```ts
export async function getWorkersOverview(): Promise<WorkerOverviewRow[]> {
  const currentUser = await requireCurrentUser();
  return getWorkersOverviewForUser(currentUser.id);
}
```

- [ ] **Step 4: Create `src/components/WorkersOverviewLive.tsx`:**

```tsx
"use client";

import React, { useEffect, useState } from "react";

import { workerStatusStyles } from "@/lib/ui/status-styles";
import type { WorkerOverviewRow } from "@/lib/workers/overview";

const POLL_MS = 20_000;

type WorkersOverviewLiveProps = {
  initialWorkers: WorkerOverviewRow[];
  overviewAction?: () => Promise<WorkerOverviewRow[]>;
};

function elapsedLabel(startedAt: Date | null): string {
  if (!startedAt) return "";
  const ms = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m elapsed`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h elapsed`;
}

function laneBadge(lane: string) {
  return (
    <span className="rounded border border-rf-border bg-rf-surface px-2 py-0.5 text-xs font-bold uppercase tracking-[0.16em] text-rf-muted">
      {lane}
    </span>
  );
}

export function WorkersOverviewLive({ initialWorkers, overviewAction }: WorkersOverviewLiveProps) {
  const [workers, setWorkers] = useState<WorkerOverviewRow[]>(initialWorkers);

  useEffect(() => {
    if (!overviewAction) return;
    let active = true;
    const id = setInterval(() => {
      overviewAction()
        .then((next) => {
          if (active) setWorkers(next);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [overviewAction]);

  if (workers.length === 0) {
    return (
      <p className="rounded-md border border-rf-border bg-rf-surface p-4 text-sm text-rf-muted">
        No workers registered yet. Create one above to get started.
      </p>
    );
  }

  return (
    <ul className="grid gap-3">
      {workers.map((worker) => {
        const status = worker.status;
        const current = worker.currentJobs[0];
        return (
          <li key={worker.id} className="rounded-md border border-rf-border bg-rf-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium ${workerStatusStyles[status]}`}
                role="status"
              >
                <span className="h-2 w-2 shrink-0 rounded-sm bg-current" aria-hidden="true" />
                {status}
              </span>
              <span className="font-semibold text-rf-white">{worker.label}</span>
              {laneBadge(worker.lane)}
              <span className="text-sm text-rf-muted">
                {current
                  ? `running ${current.jobType}`
                  : status === "online"
                    ? "idle"
                    : "—"}
              </span>
            </div>

            {current ? (
              <p className="mt-2 text-sm text-rf-muted">
                ▸ <span className="text-rf-white">{current.targetLabel}</span> · {elapsedLabel(current.startedAt)}
              </p>
            ) : null}

            {worker.recentLogs.length > 0 ? (
              <ul className="mt-2 grid gap-1 text-xs text-rf-muted">
                {worker.recentLogs.map((log) => (
                  <li key={log.id}>
                    {log.level === "failed" ? "✗" : "✓"} {log.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Run the component test to verify it passes**

```
npm test -- tests/workers-overview-live.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Host the overview in `WorkerSetupContent`** — replace the "Current worker status" `<section>` (the one containing `<WorkerStatusLive>` and the `<table>`) in `src/components/WorkerSetupContent.tsx` with a section that renders `<WorkersOverviewLive>`. Update the props type and imports:

Change the imports at the top:
```tsx
import { WorkersOverviewLive } from "@/components/WorkersOverviewLive";
import type { WorkerOverviewRow } from "@/lib/workers/overview";
```
(Remove the now-unused `WorkerStatusLive` and `WorkerStatus` imports and the `WorkerStatusRow` type / `formatDate` helper if they become unused.)

Change `WorkerSetupContentProps`:
```tsx
type WorkerSetupContentProps = {
  appUrl: string;
  registrationAction: WorkerRegistrationAction;
  registrationResult?: WorkerRegistrationActionState;
  initialWorkers: WorkerOverviewRow[];
  overviewAction?: () => Promise<WorkerOverviewRow[]>;
};
```
Update the function signature/destructuring to match (drop `workers`, `initialWorkerStatus`, `statusAction`; add `initialWorkers`, `overviewAction`).

Replace the entire status `<section>` with:
```tsx
      <section className="rounded-md border border-rf-border bg-rf-panel p-5">
        <h2 className="text-xl font-semibold text-rf-white">Your workers</h2>
        <div className="mt-4">
          <WorkersOverviewLive initialWorkers={initialWorkers} overviewAction={overviewAction} />
        </div>
      </section>
```

- [ ] **Step 7: Feed the overview from the page** — replace `src/app/workers/page.tsx` with:

```tsx
import React from "react";
import { headers } from "next/headers";

import { PageShell } from "@/components/PageShell";
import { WorkerSetupContent } from "@/components/WorkerSetupContent";
import { getWorkersOverview, registerWorker } from "@/app/workers/actions";
import { getWorkersOverviewForUser } from "@/lib/workers/overview";
import { requireCurrentUser } from "@/lib/auth/session";
import { resolveWorkerSetupAppUrl } from "@/lib/jobs/worker-setup-url";

export default async function WorkersPage() {
  const currentUser = await requireCurrentUser();
  const [headerList, initialWorkers] = await Promise.all([
    headers(),
    getWorkersOverviewForUser(currentUser.id)
  ]);

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="workers"
    >
      <WorkerSetupContent
        appUrl={resolveWorkerSetupAppUrl(headerList)}
        registrationAction={registerWorker}
        registrationResult={null}
        initialWorkers={initialWorkers}
        overviewAction={getWorkersOverview}
      />
    </PageShell>
  );
}
```

- [ ] **Step 8: Check for orphaned status code** — `WorkerStatusLive` and `getCurrentWorkerStatus` are no longer used by the page. Check for any remaining references:

```
npm test -- tests/workers-overview-live.test.tsx
```
then grep the codebase:

Run a project search for `WorkerStatusLive` and `getCurrentWorkerStatus`. If `WorkerStatusLive` has no remaining importers, delete `src/components/WorkerStatusLive.tsx` and remove the now-unused `getCurrentWorkerStatus` export from `src/app/workers/actions.ts` (and `resolveWorkerStatusForUser` only if it too has no other importers — keep it if anything else imports it). Do NOT remove `WorkerStatusPanel`/`workerStatusStyles` (reused by the overview).

- [ ] **Step 9: Full UI check**

```
npm test -- tests/workers-overview-live.test.tsx
npx tsc --noEmit --pretty false
npm run build
```
Expected: PASS and exit 0. (`npm run build` 1-2 min; pre-existing Next/Auth warnings are fine.)

- [ ] **Step 10: Commit**

```bash
git add src/app/workers/actions.ts src/components/WorkersOverviewLive.tsx src/components/WorkerSetupContent.tsx "src/app/workers/page.tsx" tests/workers-overview-live.test.tsx
# include deletions if you removed WorkerStatusLive / getCurrentWorkerStatus
git add -A
git commit -m "feat: multi-worker dashboard with live activity"
```

---

## Task 7: Worker creation with lane + multi-worker install

**Files:**
- Modify: `src/lib/jobs/worker-registration.ts`
- Modify: `src/app/workers/actions.ts`
- Modify: `src/components/WorkerSetupContent.tsx`
- Modify: `scripts/install-worker.ps1`
- Test: `tests/worker-registration.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/worker-registration.test.ts`:

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

describe("registerWorkerForUser", () => {
  it("persists the chosen lane", async () => {
    const { registerWorkerForUser } = await import("@/lib/jobs/worker-registration");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "register@example.com" } });

      const result = await registerWorkerForUser({
        userId: user.id, label: "ResearchFinder Inbox Worker", lane: "inbox"
      });

      const worker = await client.workerRegistration.findUniqueOrThrow({ where: { id: result.workerId } });
      expect(worker.lane).toBe("inbox");
      expect(worker.label).toBe("ResearchFinder Inbox Worker");
      expect(typeof result.token).toBe("string");
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-registration.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — `registerWorkerForUser` does not accept `lane`.

- [ ] **Step 3: Accept `lane` in `registerWorkerForUser`** — replace `src/lib/jobs/worker-registration.ts`:

```ts
import { prisma } from "@/lib/db";
import { createWorkerToken, hashWorkerToken } from "@/lib/jobs/worker-auth";
import type { WorkerLane } from "@/lib/v2/domain";

export async function registerWorkerForUser(input: { userId: string; label: string; lane: WorkerLane }) {
  const token = createWorkerToken();
  const tokenHash = await hashWorkerToken(token);

  const worker = await prisma.workerRegistration.create({
    data: {
      userId: input.userId,
      label: input.label,
      tokenHash,
      status: "active",
      lane: input.lane
    },
    select: { id: true }
  });

  return {
    workerId: worker.id,
    token
  };
}
```

- [ ] **Step 4: Run the registration test to verify it passes**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- tests/worker-registration.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 5: Read lane from the form in `registerWorker`** — replace the `registerWorker` action in `src/app/workers/actions.ts` with:

```ts
import { WORKER_LANES, type WorkerLane } from "@/lib/v2/domain";
```
```ts
const DEFAULT_LABELS: Record<WorkerLane, string> = {
  inbox: "ResearchFinder Inbox Worker",
  research: "ResearchFinder Research Worker",
  both: "ResearchFinder Worker"
};

function readLane(value: FormDataEntryValue | null): WorkerLane {
  return WORKER_LANES.includes(value as WorkerLane) ? (value as WorkerLane) : "both";
}

export async function registerWorker(
  previousState: WorkerRegistrationActionState,
  formData: FormData
): Promise<WorkerRegistrationActionState> {
  void previousState;

  const currentUser = await requireCurrentUser();
  const lane = readLane(formData.get("lane"));
  const label = DEFAULT_LABELS[lane];
  const registration = await registerWorkerForUser({
    userId: currentUser.id,
    label,
    lane
  });

  return { token: registration.token, label, lane };
}
```
Update the import of `registerWorkerForUser` if needed (already imported). Ensure the `WorkerRegistrationActionState` type (in `WorkerSetupContent.tsx`) is widened in Step 6.

- [ ] **Step 6: Lane select + task-named install command** — in `src/components/WorkerSetupContent.tsx`:

Widen the action state type:
```tsx
export type WorkerRegistrationActionState = { token: string; label: string; lane: string } | null;
```
Change `setupCommand` to include `-TaskName` (the label doubles as the unique scheduled-task name):
```tsx
function setupCommand(appUrl: string, token: string, taskName: string) {
  return `powershell -ExecutionPolicy Bypass -File scripts/install-worker.ps1 -AppUrl ${quotePowerShellLiteral(appUrl)} -WorkerToken ${quotePowerShellLiteral(token)} -TaskName ${quotePowerShellLiteral(taskName)}`;
}
```
Add a lane `<select name="lane">` inside the create `<form>` (before the submit button):
```tsx
            <select
              name="lane"
              defaultValue="both"
              className="rounded-md border border-rf-border bg-rf-surface px-3 py-2 text-sm text-rf-white"
            >
              <option value="inbox">Inbox lane (daily inbox + novelty)</option>
              <option value="research">Research lane (viability + research plans)</option>
              <option value="both">Both (default)</option>
            </select>
```
Update the command render to pass the label as the task name:
```tsx
        {state?.token ? (
          <pre className="mt-4 overflow-x-auto rounded-md bg-rf-surface p-4 text-sm text-rf-white">
            <code>{setupCommand(appUrl, state.token, state.label)}</code>
          </pre>
        ) : (
```

- [ ] **Step 7: Parameterize the install script** — in `scripts/install-worker.ps1`, change the `param(...)` block and the task/shortcut/install-dir to use a `-TaskName`:

Replace the `param(...)` block:
```powershell
param(
  [Parameter(Mandatory=$true)][string]$AppUrl,
  [Parameter(Mandatory=$true)][string]$WorkerToken,
  [string]$TaskName = "ResearchFinder Worker",
  [string]$InstallDir = ""
)

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $safeName = ($TaskName -replace '[^A-Za-z0-9 _-]', '').Trim()
  if ([string]::IsNullOrWhiteSpace($safeName)) { $safeName = "ResearchFinder Worker" }
  $InstallDir = Join-Path "$env:LOCALAPPDATA\ResearchFinderWorker" $safeName
}
```
Change the `Register-ScheduledTask` task name from the hardcoded `"ResearchFinder Worker"` to `$TaskName`:
```powershell
Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $dailyTrigger, $logonTrigger `
  -Settings $settings `
  -Description "Runs local Codex-backed ResearchFinder jobs for the signed-in user." `
  -Force | Out-Null
```
Change the shortcut filename from `"ResearchFinder Worker.lnk"` to use the task name:
```powershell
  $shortcutPath = Join-Path $dir ("{0}.lnk" -f $TaskName)
```
(Per-worker `$InstallDir` isolates each worker's `.worker.json` + `run-worker.ps1`; per-worker `$TaskName` lets multiple scheduled tasks coexist. Omitting `-TaskName` reproduces today's single-worker install for backward compatibility.)

- [ ] **Step 8: Typecheck + targeted tests**

```
npx tsc --noEmit --pretty false
npm test -- tests/worker-registration.test.ts tests/workers-overview-live.test.tsx
```
Expected: exit 0 and PASS. (PowerShell has no test harness in this repo; the install script change is verified by review + the manual smoke test in the deployment notes.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/jobs/worker-registration.ts src/app/workers/actions.ts src/components/WorkerSetupContent.tsx scripts/install-worker.ps1 tests/worker-registration.test.ts
git commit -m "feat: choose a lane when creating a worker and support multiple workers per machine"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + types**

```
npm run lint
npx tsc --noEmit --pretty false
```
Expected: both exit 0 (pre-existing warnings OK; no errors).

- [ ] **Step 2: Full test suite with Postgres**

```
TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test' npm test -- --no-file-parallelism --testTimeout 60000
```
Expected: all pass except the one pre-existing intentional skip (`tests/codex-runner.test.ts`).

- [ ] **Step 3: Build**

```
npm run build
```
Expected: exit 0.

---

## Deployment Notes (post-merge, user-run)

- Apply the migration to Neon: `npm run db:deploy` (applies `20260626120000_worker_lane`; existing workers default to `lane = "both"`).
- No automatic worker reinstall. To split lanes: on the `/workers` page, create an **Inbox** worker and a **Research** worker; run each emitted install command (each uses a distinct `-TaskName`, so both scheduled tasks/configs coexist). The existing single worker keeps running as `both` until replaced.
- Smoke test: create an Inbox-lane worker → confirm it appears on the dashboard; dispatch a `research_plan` ("Develop this") → confirm the Inbox worker does NOT pick it up (stays queued) while a Both/Research worker does; confirm the dashboard shows the running job and, after it finishes, a history entry.

## Implementation Notes

- Worker claim priority within a lane is unchanged: `inbox_generation → novelty_scan → viability_check → research_plan`.
- Lane is server-side only (on `WorkerRegistration`); the worker binary and its config/token are untouched.
- `WorkerJobLog` writes are best-effort and must never break completion/failure handling.
- Out of scope (Sub-project 2): the local launcher/agent and true one-click spin up / tear down; pause/resume.
