# Backlog Suppression & Worker Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a reconnecting worker from generating a backlog of old inboxes (process only the latest day), and make the local worker stay alive and easy to restart from the `/workers` page.

**Architecture:** Part 1 adds a `superseded` terminal status to `InboxGenerationJob` set inside `createInboxGenerationJob`'s transaction, so at most one inbox is ever pending per user; the inbox UI hides/labels superseded days. Part 2 hardens the installed Windows Scheduled Task (auto-start at logon, restart on failure, no machine wake), drops a double-click shortcut, and upgrades `/workers` with a live, auto-refreshing status badge plus an offline restart callout.

**Tech Stack:** Next.js 15 App Router (server components + server actions), TypeScript, Prisma/Postgres, Vitest + Testing Library, PowerShell (Windows Task Scheduler), Tailwind (`rf.*` tokens).

**Reference spec:** `docs/superpowers/specs/2026-06-25-backlog-suppression-and-worker-control-design.md`

**Status (`String`, not enum):** all job models use a free-form `status String`, so the new `"superseded"` value needs **no migration**.

**Postgres test command (PowerShell):**
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/<file> --no-file-parallelism --testTimeout 60000
```
(The same command in bash uses an inline prefix: `TEST_DATABASE_URL='...' npm test -- ...`.)

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/jobs/inbox-generation.ts` | Inbox job lifecycle + inbox state reads | Supersede older pending jobs; teach reads about `superseded` |
| `src/app/inbox/[userId]/page.tsx` | Inbox page rendering | Render a `superseded` notice |
| `src/lib/workers/status.ts` | Resolve a user's worker status | Tighten online window to 2 min |
| `scripts/install-worker.ps1` | Windows worker installer | Harden scheduled task + create shortcut |
| `src/components/WorkerStatusLive.tsx` | **New** client status badge + offline callout | Create |
| `src/components/WorkerSetupContent.tsx` | `/workers` content | Mount `WorkerStatusLive` |
| `src/app/workers/page.tsx` | `/workers` page | Resolve status + pass status action |
| `src/app/workers/actions.ts` | `/workers` server actions | Add `getCurrentWorkerStatus` |
| `tests/inbox-generation-supersede.test.ts` | **New** Postgres tests for Part 1 | Create |
| `tests/worker-status.test.ts` | Worker status unit tests | Update threshold cases |
| `tests/install-worker.test.ts` | Installer assertions | Extend |
| `tests/worker-status-live.test.tsx` | **New** status badge/callout tests | Create |
| `tests/worker-setup-page.test.tsx` | `/workers` page tests | Update db mock |

---

# PART 1 — Backlog Suppression

## Task 1: Supersede older pending inbox jobs

**Files:**
- Modify: `src/lib/jobs/inbox-generation.ts` (inside `createInboxGenerationJob`, between the existing failed/stale reset `updateMany` and the final `upsert`, around lines 63–65)
- Test: `tests/inbox-generation-supersede.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/inbox-generation-supersede.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";
import { staleRunningJobStartedBefore } from "@/lib/jobs/lifecycle";

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

async function createCompletedBatch(client: PrismaClient, userId: string, inboxDate: string) {
  const batch = await client.candidateBatch.create({
    data: {
      userId,
      inboxDate,
      source: "arxiv",
      query: "cat:cs.AI",
      status: "completed",
      completedAt: new Date()
    }
  });
  await client.candidatePaper.create({
    data: {
      batchId: batch.id,
      arxivId: `arxiv-${inboxDate}`,
      title: `Paper ${inboxDate}`,
      abstract: "Abstract",
      url: `https://arxiv.org/abs/${inboxDate}`,
      publishedAt: new Date(),
      authorsJson: "[]",
      categoriesJson: "[]",
      rawJson: "{}"
    }
  });
  return batch;
}

async function createInboxJob(
  client: PrismaClient,
  userId: string,
  batchId: string,
  inboxDate: string,
  status: string,
  startedAt: Date | null = null
) {
  return client.inboxGenerationJob.create({
    data: {
      userId,
      candidateBatchId: batchId,
      inboxDate,
      status,
      startedAt,
      inputJson: JSON.stringify({ candidateBatchId: batchId })
    }
  });
}

describe("createInboxGenerationJob backlog suppression", () => {
  it("supersedes older queued and stale-running jobs and leaves the newest claimable", async () => {
    const { createInboxGenerationJob, claimNextInboxGenerationJob } = await import(
      "@/lib/jobs/inbox-generation"
    );
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "backlog@example.com" } });

      const queuedBatch = await createCompletedBatch(client, user.id, "2026-06-20");
      const queuedOld = await createInboxJob(client, user.id, queuedBatch.id, "2026-06-20", "queued");

      const staleBatch = await createCompletedBatch(client, user.id, "2026-06-21");
      const staleOld = await createInboxJob(
        client,
        user.id,
        staleBatch.id,
        "2026-06-21",
        "running",
        new Date(staleRunningJobStartedBefore().getTime() - 60_000)
      );

      const freshBatch = await createCompletedBatch(client, user.id, "2026-06-22");
      const freshRunning = await createInboxJob(
        client,
        user.id,
        freshBatch.id,
        "2026-06-22",
        "running",
        new Date()
      );

      const newBatch = await createCompletedBatch(client, user.id, "2026-06-25");
      const created = await createInboxGenerationJob({
        userId: user.id,
        candidateBatchId: newBatch.id,
        inboxDate: "2026-06-25"
      });

      const reread = async (id: string) =>
        (await client.inboxGenerationJob.findUniqueOrThrow({ where: { id } })).status;

      expect(await reread(queuedOld.id)).toBe("superseded");
      expect(await reread(staleOld.id)).toBe("superseded");
      expect(await reread(freshRunning.id)).toBe("running");
      expect(created.status).toBe("queued");

      const claimed = await claimNextInboxGenerationJob({ userId: user.id, workerId: "w1" });
      expect(claimed?.id).toBe(created.id);
      expect(claimed?.inboxDate).toBe("2026-06-25");
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/inbox-generation-supersede.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — `queuedOld`/`staleOld` are still `"queued"`/`"running"` (no supersede yet), and `claimNextInboxGenerationJob` returns the oldest (`2026-06-20`) instead of `created`.

- [ ] **Step 3: Implement the supersede**

In `src/lib/jobs/inbox-generation.ts`, inside `createInboxGenerationJob`'s transaction, add this block immediately **before** the `return tx.inboxGenerationJob.upsert({` line:

```ts
    // Backlog suppression: a worker that has been offline must never generate a
    // pile of past-day inboxes. Mark every older still-pending inbox job for this
    // user as superseded so only the newest day remains claimable. Scope to
    // strictly older dates so today's upsert below is untouched, and only treat
    // genuinely abandoned running jobs (past the stale cutoff) as supersedable.
    await tx.inboxGenerationJob.updateMany({
      where: {
        userId: input.userId,
        inboxDate: { lt: input.inboxDate },
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: staleRunningJobStartedBefore() } }
        ]
      },
      data: {
        status: "superseded",
        claimedByWorkerId: null,
        completedAt: new Date(),
        errorMessage: "Superseded by a newer day's inbox while the worker was offline"
      }
    });

```

(`staleRunningJobStartedBefore` is already imported at the top of this file.)

- [ ] **Step 4: Run the test to verify it passes**

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/inbox-generation-supersede.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/inbox-generation-supersede.test.ts src/lib/jobs/inbox-generation.ts
git commit -m "feat: supersede older pending inbox jobs"
```

---

## Task 2: Teach inbox reads about superseded days

**Files:**
- Modify: `src/lib/jobs/inbox-generation.ts` (`listInboxDatesForUser` ~lines 322–342; `getGeneratedInboxState` ~lines 344–379)
- Test: `tests/inbox-generation-supersede.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Append these two `it` blocks inside the existing `describe` in `tests/inbox-generation-supersede.test.ts`:

```ts
  it("excludes superseded-only dates from listInboxDatesForUser", async () => {
    const { listInboxDatesForUser } = await import("@/lib/jobs/inbox-generation");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "dates@example.com" } });

      const supBatch = await createCompletedBatch(client, user.id, "2026-06-20");
      await createInboxJob(client, user.id, supBatch.id, "2026-06-20", "superseded");

      const queuedBatch = await createCompletedBatch(client, user.id, "2026-06-25");
      await createInboxJob(client, user.id, queuedBatch.id, "2026-06-25", "queued");

      const dates = await listInboxDatesForUser(user.id);
      expect(dates).toEqual(["2026-06-25"]);
    });
  });

  it("reports superseded state for a superseded date", async () => {
    const { getGeneratedInboxState } = await import("@/lib/jobs/inbox-generation");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "state@example.com" } });

      const supBatch = await createCompletedBatch(client, user.id, "2026-06-20");
      await createInboxJob(client, user.id, supBatch.id, "2026-06-20", "superseded");

      const state = await getGeneratedInboxState(user.id, "2026-06-20");
      expect(state.status).toBe("superseded");
      expect(state.ideas).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/inbox-generation-supersede.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: the run FAILS because the `listInboxDatesForUser` test fails — `2026-06-20` is still included. (The `getGeneratedInboxState` test may already pass at runtime: the current code returns `latestJob.status` through an unsafe `as` cast, so the runtime value is already `"superseded"`. Step 3 adds an explicit branch to make the return *type* honest and guard the behavior.)

- [ ] **Step 3: Implement the read changes**

In `listInboxDatesForUser`, change the `inboxGenerationJob.findMany` call to exclude superseded:

```ts
    prisma.inboxGenerationJob.findMany({
      where: { userId, status: { not: "superseded" } },
      distinct: ["inboxDate"],
      select: { inboxDate: true }
    })
```

In `getGeneratedInboxState`, add an explicit superseded branch immediately after the `if (latestJob.status === "failed")` line and before the final `return`:

```ts
  if (!latestJob) return { status: "pending" as const, ideas: [] };
  if (latestJob.status === "failed") return { status: "failed" as const, ideas: [] };
  if (latestJob.status === "superseded") return { status: "superseded" as const, ideas: [] };
  return {
    status: latestJob.status as "queued" | "running" | "completed" | "timed_out",
    ideas: []
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/inbox-generation-supersede.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add tests/inbox-generation-supersede.test.ts src/lib/jobs/inbox-generation.ts
git commit -m "feat: hide and label superseded inbox days"
```

---

## Task 3: Render a superseded notice on the inbox page

**Files:**
- Modify: `src/app/inbox/[userId]/page.tsx` (`renderInboxStatus`, ~lines 112–165)

No unit test: `renderInboxStatus` is a module-internal helper and the inbox page has heavy server-only dependencies that the codebase does not unit-render. This is verified by `tsc` + `build`, consistent with the existing inbox page (which has no render test). The server state itself is tested in Task 2.

- [ ] **Step 1: Add the superseded case**

In `renderInboxStatus`, add a `case "superseded":` immediately before `case "completed":`:

```ts
    case "superseded":
      return (
        <StatusCard title="Day skipped">
          Your worker was offline when {inboxDate} was scheduled, so it was skipped to keep your
          inbox current. Only the latest day is generated when your worker reconnects.
        </StatusCard>
      );
```

- [ ] **Step 2: Verify types and build**

```powershell
npx tsc --noEmit --pretty false
npm run build
```
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/inbox/[userId]/page.tsx
git commit -m "feat: show skipped notice for superseded inbox days"
```

---

# PART 2 — Worker Reliability & Control UX

## Task 4: Tighten the worker online threshold to 2 minutes

**Files:**
- Modify: `src/lib/workers/status.ts:4`
- Test: `tests/worker-status.test.ts` (add boundary cases)

- [ ] **Step 1: Write the failing tests**

Add these two `it` blocks inside the `describe("resolveWorkerStatusForUser", ...)` in `tests/worker-status.test.ts`:

```ts
  it("reports online when seen 90 seconds ago", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "recent@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id,
          label: "Local worker",
          tokenHash: "hash",
          status: "active",
          lastSeenAt: new Date(Date.now() - 90 * 1000)
        }
      });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("online");
    });
  });

  it("reports offline when seen 5 minutes ago", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "lapsed@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id,
          label: "Local worker",
          tokenHash: "hash",
          status: "active",
          lastSeenAt: new Date(Date.now() - 5 * 60 * 1000)
        }
      });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("offline");
    });
  });
```

- [ ] **Step 2: Run the tests to verify the offline case fails**

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/worker-status.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — "seen 5 minutes ago" currently returns `"online"` because the window is 10 minutes.

- [ ] **Step 3: Tighten the window**

In `src/lib/workers/status.ts`, change line 4:

```ts
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
```

- [ ] **Step 4: Run the tests to verify they pass**

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/worker-status.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workers/status.ts tests/worker-status.test.ts
git commit -m "feat: tighten worker online window to 2 minutes"
```

---

## Task 5: Harden the scheduled task and add a shortcut

**Files:**
- Modify: `scripts/install-worker.ps1` (trigger/settings block, lines 63–77)
- Test: `tests/install-worker.test.ts` (add assertions)

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `tests/install-worker.test.ts` (the `installerScript` constant is already defined at the top of the file):

```ts
describe("worker installer resilience", () => {
  it("starts at logon in addition to the daily trigger", () => {
    expect(installerScript).toContain("New-ScheduledTaskTrigger -Daily -At 6:00am");
    expect(installerScript).toContain("New-ScheduledTaskTrigger -AtLogOn");
  });

  it("restarts on failure and never wakes the machine", () => {
    expect(installerScript).toContain("-RestartCount");
    expect(installerScript).toContain("-RestartInterval");
    expect(installerScript).toContain("-MultipleInstances IgnoreNew");
    expect(installerScript).not.toContain("-WakeToRun");
  });

  it("creates a double-click ResearchFinder Worker shortcut", () => {
    expect(installerScript).toContain("WScript.Shell");
    expect(installerScript).toContain("ResearchFinder Worker.lnk");
    expect(installerScript).toContain(".Save()");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npm test -- tests/install-worker.test.ts
```
Expected: FAIL — no `AtLogOn`, no restart settings, `-WakeToRun` still present, no shortcut.

- [ ] **Step 3: Update the installer**

In `scripts/install-worker.ps1`, replace the trigger/settings/register block (currently lines 63–77, from `$action = New-ScheduledTaskAction` through the `Register-ScheduledTask ... -Force | Out-Null`) with:

```powershell
$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`"" `
  -WorkingDirectory $repoPath

$dailyTrigger = New-ScheduledTaskTrigger -Daily -At 6:00am
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName "ResearchFinder Worker" `
  -Action $action `
  -Trigger $dailyTrigger, $logonTrigger `
  -Settings $settings `
  -Description "Runs local Codex-backed ResearchFinder jobs for the signed-in user." `
  -Force | Out-Null

$WshShell = New-Object -ComObject WScript.Shell
$shortcutDirs = @(
  [Environment]::GetFolderPath("Desktop"),
  [Environment]::GetFolderPath("Programs")
)
foreach ($dir in $shortcutDirs) {
  $shortcutPath = Join-Path $dir "ResearchFinder Worker.lnk"
  $shortcut = $WshShell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
  $shortcut.WorkingDirectory = $repoPath
  $shortcut.Description = "Start the ResearchFinder Codex worker"
  $shortcut.Save()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```powershell
npm test -- tests/install-worker.test.ts
```
Expected: PASS (all old + new assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/install-worker.ps1 tests/install-worker.test.ts
git commit -m "feat: harden worker scheduled task and add start shortcut"
```

---

## Task 6: Live status panel + offline restart callout

**Files:**
- Create: `src/components/WorkerStatusLive.tsx`
- Modify: `src/app/workers/actions.ts`, `src/components/WorkerSetupContent.tsx`, `src/app/workers/page.tsx`
- Test: `tests/worker-status-live.test.tsx` (create), `tests/worker-setup-page.test.tsx` (update db mock)

- [ ] **Step 1: Write the failing test**

Create `tests/worker-status-live.test.tsx`:

```tsx
import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkerStatusLive } from "@/components/WorkerStatusLive";

describe("WorkerStatusLive", () => {
  it("shows the offline restart callout when offline", () => {
    render(<WorkerStatusLive initialStatus="offline" />);
    expect(screen.getByText("Worker offline")).toBeInTheDocument();
    expect(screen.getByText("Worker not running")).toBeInTheDocument();
    expect(screen.getByText('schtasks /run /tn "ResearchFinder Worker"')).toBeInTheDocument();
  });

  it("hides the callout when online", () => {
    render(<WorkerStatusLive initialStatus="online" />);
    expect(screen.getByText("Worker online")).toBeInTheDocument();
    expect(screen.queryByText("Worker not running")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
npm test -- tests/worker-status-live.test.tsx
```
Expected: FAIL — module `@/components/WorkerStatusLive` does not exist.

- [ ] **Step 3: Create the client component**

Create `src/components/WorkerStatusLive.tsx`:

```tsx
"use client";

import React, { useEffect, useState } from "react";

import { WorkerStatusPanel, type WorkerStatus } from "@/components/WorkerStatusPanel";

const POLL_MS = 30_000;
const RESTART_COMMAND = 'schtasks /run /tn "ResearchFinder Worker"';

type WorkerStatusLiveProps = {
  initialStatus: WorkerStatus;
  statusAction?: () => Promise<WorkerStatus>;
};

export function WorkerStatusLive({ initialStatus, statusAction }: WorkerStatusLiveProps) {
  const [status, setStatus] = useState<WorkerStatus>(initialStatus);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!statusAction) return;
    let active = true;
    const id = setInterval(() => {
      statusAction()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [statusAction]);

  return (
    <div className="grid gap-3">
      <WorkerStatusPanel status={status} />
      {status === "offline" ? (
        <div className="rounded-md border border-rf-border bg-rf-surface p-4 text-sm text-rf-muted">
          <p className="font-medium text-rf-white">Worker not running</p>
          <p className="mt-1">
            Double-click the <strong className="text-rf-white">ResearchFinder Worker</strong> shortcut
            on your Desktop or Start menu, or run this command in PowerShell:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-rf-panel px-2 py-1 text-rf-white">{RESTART_COMMAND}</code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(RESTART_COMMAND);
                setCopied(true);
              }}
              className="rounded-md bg-rf-violet px-3 py-1 text-xs font-semibold text-rf-white transition-colors hover:bg-rf-violetSoft"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
npm test -- tests/worker-status-live.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Add the status server action**

In `src/app/workers/actions.ts`, add this export (the file already starts with `"use server"` and imports `requireCurrentUser`):

```ts
import type { WorkerStatus } from "@/components/WorkerStatusPanel";
import { resolveWorkerStatusForUser } from "@/lib/workers/status";

export async function getCurrentWorkerStatus(): Promise<WorkerStatus> {
  const currentUser = await requireCurrentUser();
  return resolveWorkerStatusForUser(currentUser.id);
}
```

- [ ] **Step 6: Mount the live panel in WorkerSetupContent**

In `src/components/WorkerSetupContent.tsx`:

Add to the imports at the top:

```tsx
import { WorkerStatusLive } from "@/components/WorkerStatusLive";
import type { WorkerStatus } from "@/components/WorkerStatusPanel";
```

Extend `WorkerSetupContentProps` with two optional props:

```tsx
type WorkerSetupContentProps = {
  appUrl: string;
  workers: WorkerStatusRow[];
  registrationAction: WorkerRegistrationAction;
  registrationResult?: WorkerRegistrationActionState;
  initialWorkerStatus?: WorkerStatus;
  statusAction?: () => Promise<WorkerStatus>;
};
```

Update the function signature defaults:

```tsx
export function WorkerSetupContent({
  appUrl,
  workers,
  registrationAction,
  registrationResult = null,
  initialWorkerStatus = "unknown",
  statusAction
}: WorkerSetupContentProps) {
```

Then, inside the `<section>` titled "Current worker status", insert the live panel immediately after the `<h2 ...>Current worker status</h2>` line and before the `<div className="mt-4 overflow-x-auto">` table wrapper:

```tsx
        <div className="mt-4">
          <WorkerStatusLive initialStatus={initialWorkerStatus} statusAction={statusAction} />
        </div>
```

- [ ] **Step 7: Wire the page**

In `src/app/workers/page.tsx`:

Add imports:

```tsx
import { getCurrentWorkerStatus, registerWorker } from "@/app/workers/actions";
import { resolveWorkerStatusForUser } from "@/lib/workers/status";
```

(Replace the existing `import { registerWorker } from "@/app/workers/actions";` line with the combined import above.)

Resolve the status alongside the existing `Promise.all`. Change the destructuring to also fetch status:

```tsx
  const [headerList, workers, workerStatus] = await Promise.all([
    headers(),
    prisma.workerRegistration.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        revokedAt: true
      }
    }),
    resolveWorkerStatusForUser(currentUser.id)
  ]);
```

Pass the two new props to `WorkerSetupContent`:

```tsx
      <WorkerSetupContent
        appUrl={resolveWorkerSetupAppUrl(headerList)}
        workers={workers}
        registrationAction={registerWorker}
        registrationResult={null}
        initialWorkerStatus={workerStatus}
        statusAction={getCurrentWorkerStatus}
      />
```

- [ ] **Step 8: Update the page test's db mock**

`src/app/workers/page.tsx` now calls `resolveWorkerStatusForUser`, which calls `prisma.workerRegistration.findFirst`. In `tests/worker-setup-page.test.tsx`, update the `@/lib/db` mock (lines 21–28) to add `findFirst`:

```tsx
vi.mock("@/lib/db", () => ({
  prisma: {
    workerRegistration: {
      create: (...args: unknown[]) => mocked.createWorker(...args),
      findMany: (...args: unknown[]) => mocked.findWorkers(...args),
      findFirst: (...args: unknown[]) => mocked.findWorker(...args)
    }
  }
}));
```

Add `findWorker: vi.fn()` to the `vi.hoisted(() => ({ ... }))` object (alongside `findWorkers`), and in `beforeEach` add:

```tsx
    mocked.findWorker.mockResolvedValue(null);
```

- [ ] **Step 9: Run the affected component/page tests**

```powershell
npm test -- tests/worker-status-live.test.tsx tests/worker-setup-page.test.tsx
```
Expected: PASS (the page test now renders with `findFirst` mocked → status resolves to `offline`).

- [ ] **Step 10: Verify types and build**

```powershell
npx tsc --noEmit --pretty false
npm run build
```
Expected: both exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/components/WorkerStatusLive.tsx src/app/workers/actions.ts src/components/WorkerSetupContent.tsx src/app/workers/page.tsx tests/worker-status-live.test.tsx tests/worker-setup-page.test.tsx
git commit -m "feat: live worker status panel with offline restart callout"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + types**

```powershell
npm run lint
npx tsc --noEmit --pretty false
```
Expected: both exit 0.

- [ ] **Step 2: Full test suite with Postgres**

```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- --no-file-parallelism --testTimeout 60000
```
Expected: all tests pass except the one pre-existing intentional skip.

- [ ] **Step 3: Build**

```powershell
npm run build
```
Expected: exit 0.

---

## Deployment Notes (post-merge, user-run)

- **Part 1** takes effect as soon as the merged code is deployed (Vercel auto-deploys `main`). The historical multi-day backlog collapses to one pending day the next time the cron creates a job for each user — no manual cleanup needed.
- **Part 2** changes the installer. To pick up the hardened scheduled task + shortcut, **re-run the worker setup command** from `/workers` once on the Windows machine (it re-registers the task with `-Force`). Existing `.worker.json` / token are reused; no token rotation required.

---

## Implementation Notes

- Keep the worker job priority order unchanged: `inbox_generation` → `novelty_scan` → `viability_check`.
- `superseded` is a plain status string; never add it to a claim query (claims must keep selecting only `queued`/stale-`running`).
- Do not re-introduce `-WakeToRun`: the task must never wake the machine from sleep.
