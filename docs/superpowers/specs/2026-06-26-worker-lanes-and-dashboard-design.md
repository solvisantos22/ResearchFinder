# Worker Lanes & Multi-Worker Dashboard — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorming)
**Sub-project:** 1 of 2 in the "worker harness operability" initiative. Sub-project 2 (a local launcher/agent for one-click spin up & tear down) is deferred to its own spec and builds on this one.

## Goal

Let a user run **multiple, purpose-scoped local workers** and **see what each one is doing**. Concretely:

1. **Lanes** — each worker is scoped to a set of job types so a long-running heavy job can never block the time-sensitive daily inbox.
2. **Dashboard** — replace the single "worker online" indicator with a live list of all the user's workers, each showing its lane, online/offline state, the job it is running right now, and a short history of what it just did.
3. **Multi-worker ergonomics** — make standing up a second, lane-scoped worker on the same machine easy (unique scheduled-task name per worker).

## Motivation

The worker model today (verified 2026-06-26):

- `WorkerRegistration` has `id, userId, label, tokenHash, status, lastSeenAt, createdAt, revokedAt` — **no job-type/capability field**.
- `POST /api/workers/claim` authenticates by token, updates `lastSeenAt`, then walks a fixed priority waterfall (`inbox_generation → novelty_scan → viability_check → research_plan`) and returns the first available job. There is **no way to restrict which job types a worker claims**.
- A single worker processes one job at a time. A worker mid-`research_plan` (a multi-minute Codex call) will not pick up the nightly inbox job until it finishes — **head-of-line blocking** of the most time-sensitive work. Every future pipeline stage adds more heavy jobs, making this worse.
- The UI shows only online/offline (`lastSeenAt` within a 120s window via `src/lib/workers/status.ts`). There is **no view of the current job**, no history, and no multi-worker overview. The `WorkerJobLog` table exists in the schema (`workerId, jobType, jobId, level, message, createdAt`) but is **never written to**.

## Non-goals (deferred to Sub-project 2)

- A local launcher/agent that spawns or kills worker processes.
- One-click "spin up" / "tear down" of workers from the UI (the app is **hosted**, so the server cannot start a process on the user's machine; this requires a local agent).
- Pause/resume of a running worker via a desired-state flag.
- Live streaming of a worker's Codex output. Jobs remain atomic; the dashboard shows current-job metadata, not streamed output.

## Design

### A. Data model

1. **Add a lane to `WorkerRegistration`:**
   ```prisma
   lane String @default("both")   // "inbox" | "research" | "both"
   ```
   A free-form `String` (consistent with the codebase's `status` convention) with a default of `"both"`. Existing rows therefore become `"both"` — **identical to today's behavior** (claims everything). New migration `prisma/migrations/<ts>_worker_lane/migration.sql` (timestamp chosen at plan time) adds the column with `DEFAULT 'both' NOT NULL`. A domain constant `WORKER_LANES = ["inbox","research","both"] as const` + `WorkerLane` type lives in `src/lib/v2/domain.ts` (where the other enum-like constants such as `RESEARCH_STAGES` live).

2. **Activate `WorkerJobLog` (no schema change).** Write one row per **terminal** job event (completed or failed):
   - `level`: `"completed"` | `"failed"`
   - `message`: a short human summary including the target (e.g. `Completed research_plan for "ProbeCraft: Adaptive Experiment Design…"`).
   - `jobType`, `jobId`, `workerId`: as recorded.
   We intentionally do **not** write a "started" row — current activity is derived live (see C), so started rows would be redundant and could go stale if a worker dies mid-job.

### B. Lanes + claim filtering

Lane → job types:

| Lane | Claims (in priority order) |
|------|----------------------------|
| `inbox` | `inbox_generation`, `novelty_scan` |
| `research` | `viability_check`, `research_plan` |
| `both` | all four (today's behavior) |

`src/app/api/workers/claim/route.ts` already resolves the `worker` from its token. It reads `worker.lane` and only attempts the claim functions whose job type is in the lane, **preserving the existing priority order within the lane**. The four claim helpers (`claimNextInboxGenerationJob`, `claimNextNoveltyScanJob`, `claimNextViabilityJob`, `claimNextResearchPlanJob`) are unchanged; only which ones are attempted changes.

**The worker binary (`scripts/researchfinder-worker.ts`) does not change** — scoping is enforced entirely server-side from the persisted lane. A worker still calls `/api/workers/claim`; the server simply never hands it an out-of-lane job.

Consequence: an `inbox`-lane worker can never be occupied by a `research_plan`/`viability_check` job, so the nightly inbox is always serviceable by it regardless of research load.

A small helper module `src/lib/workers/lanes.ts` exports an ordered `LANE_JOB_TYPES` map and `laneClaimsJobType(lane, jobType)`, keeping the claim route readable and unit-testable in isolation.

### C. Observability model

A single read function, `getWorkersOverviewForUser(userId)` (new, e.g. `src/lib/workers/overview.ts`), returns for each non-revoked worker:

- the worker fields (`id, label, lane, status, lastSeenAt`),
- `derivedStatus`: `"online" | "offline" | "needs_auth"` (reuse the existing `ONLINE_WINDOW_MS` logic from `src/lib/workers/status.ts`),
- `currentJobs[]`: **derived live** — union over the four job tables of rows where `claimedByWorkerId = worker.id AND status = "running"`, each mapped to `{ jobType, jobId, targetLabel, startedAt }`,
- `recentLogs[]`: the most recent N (e.g. 5) `WorkerJobLog` rows for the worker, newest first.

`targetLabel` per job type (human-readable):

| Job type | targetLabel source |
|----------|--------------------|
| `inbox_generation` | the inbox date (e.g. `"2026-06-25"`) |
| `novelty_scan` | the scan's inbox date |
| `viability_check` | the generated idea title |
| `research_plan` | the research project's generated idea title |

The same per-job-type lookup builds the `WorkerJobLog` message at terminal time (B.2). A helper `buildWorkerJobTargetLabel(jobType, jobId)` in `src/lib/workers/overview.ts` centralizes the switch so the live overview and the log writer agree.

Deriving current activity live (rather than from a "started" log row) guarantees accuracy even if a worker dies mid-job — when its job is reclaimed or fails, the live query reflects reality with no stale-state cleanup.

### D. Dashboard (the `/workers` page)

Replace the single-status panel with a live, multi-worker list:

```
Workers                                    [ + Add worker ]
──────────────────────────────────────────────────────────
● Inbox worker     [INBOX]    online · idle
     recent: ✓ inbox_generation · 1m ago
● Codex worker     [BOTH]     online · running research_plan
     ▸ "ProbeCraft: Adaptive Experiment Design…" · 3m elapsed
     recent: ✓ viability_check "…"  ✗ research_plan "…"
○ Old laptop       [RESEARCH] offline · last seen 2h ago    [revoke]
```

- Each row: status dot, label, **lane badge**, derived status, current job (`running <type>` + target + elapsed, or `idle`), and a compact recent-history line.
- Live polling ~every 20s via a server action returning `getWorkersOverviewForUser`, generalizing the existing `WorkerStatusLive` single-status polling to many workers (new `WorkersOverviewLive` component; `WorkerStatusLive`/`WorkerSetupContent` are refactored or superseded as needed).
- Existing actions preserved: create token, revoke.

### E. Multi-worker ergonomics

- **Add worker** flow (extends the existing create-token UI): choose a **lane** (Inbox / Research / Both, default Both) and a **label**; on submit, store `lane` on the new `WorkerRegistration` and present a tailored install command that includes a **unique scheduled-task name** derived from the label (e.g. `"ResearchFinder Inbox Worker"`), so multiple workers coexist on one machine instead of overwriting the single `"ResearchFinder Worker"` task.
- `scripts/install-worker.ps1` gains a `-TaskName` (and/or `-Label`) parameter; when omitted it defaults to today's `"ResearchFinder Worker"` for backward compatibility. The shortcut name derives from it too.
- The worker config/token carry **no lane** — lane is server-side only.

### F. Error handling & edge cases

- **Legacy workers**: default `lane = "both"` ⇒ no behavior change.
- **Overview query failures** are not special-cased: if the DB is unreachable the page surfaces a normal server-component error like any other page. We deliberately do **not** swallow per-table errors — on a live connection these queries only fail on a real bug, which should surface rather than be hidden behind an empty `currentJobs`.
- **A job type no online worker covers** (e.g. only inbox-lane workers exist, but research jobs are queued): the jobs simply stay `queued` (already visible in their own UIs, e.g. `/research`). Optional, low-priority: a small "N jobs queued with no eligible worker" hint on the dashboard — noted but not required for SP1.
- **`WorkerJobLog` write failures** must never break job completion: log-writing is best-effort (a failed log insert is swallowed/logged, not propagated), since the authoritative job-completion transaction has already committed.

### G. Testing

- **Claim lane filtering** (Postgres-backed route tests, mirroring `tests/research-worker-routes.test.ts`): an `inbox` worker is offered only inbox/novelty; a `research` worker only viability/research_plan; a `both`/legacy worker is offered all four; priority order is preserved within a lane.
- **`laneClaimsJobType` / lane map** unit tests.
- **Overview read model**: seed running jobs across tables + `WorkerJobLog` rows ⇒ `getWorkersOverviewForUser` returns correct `currentJobs` (with target labels) and `recentLogs`, and correct `derivedStatus` for online/offline/needs_auth.
- **`WorkerJobLog` is written** on both completion and failure (and not written as "started").
- **Worker-create stores the lane**; the generated install command carries the task name.
- **Component test** for `WorkersOverviewLive` rendering from mocked overview data (current job, lane badge, history, idle/offline states).

## File structure (anticipated)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `lane` to `WorkerRegistration` |
| `prisma/migrations/<ts>_worker_lane/migration.sql` | Create |
| `src/lib/v2/domain.ts` | `WORKER_LANES`, `WorkerLane` |
| `src/lib/workers/lanes.ts` | `LANE_JOB_TYPES`, `laneClaimsJobType` |
| `src/app/api/workers/claim/route.ts` | Lane-aware claim attempts |
| `src/app/api/workers/jobs/[jobId]/complete/route.ts` | Write `WorkerJobLog` terminal rows (completion + `markWorkerJobFailed`), best-effort |
| `src/lib/workers/overview.ts` | New `getWorkersOverviewForUser`, `buildWorkerJobTargetLabel` |
| `src/lib/workers/status.ts` | Reuse online-window logic |
| `src/app/workers/page.tsx`, `src/app/workers/actions.ts` | Multi-worker overview action + page |
| `src/components/WorkersOverviewLive.tsx` (+ refactor `WorkerStatusLive`/`WorkerSetupContent`) | Dashboard UI |
| `scripts/install-worker.ps1` | `-TaskName`/`-Label` param |
| Tests | per section G |

## Open questions / future work

- **Retry UX** for failed jobs/projects is out of scope here (tracked separately).
- **Sub-project 2** (local launcher) will introduce a desired-worker-set the dashboard edits and a local agent reconciles; this spec deliberately leaves room for that by keeping lane server-side and the dashboard read model independent of how a worker was started.
