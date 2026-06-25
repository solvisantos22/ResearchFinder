# Backlog Suppression & Worker Control — Design

**Date:** 2026-06-25
**Status:** Approved (pending spec review)

## Problem

Two operational gaps surfaced after the daily novelty scan shipped:

1. **Backlog flood.** The cron creates one candidate batch + one `inbox_generation`
   job per profiled user **every day**. Jobs are claimed oldest-first and the
   persistent worker drains everything. A user whose worker is offline for N days
   accumulates N unprocessed daily inboxes; when their worker reconnects it would
   generate all N (each ~10 ideas, plus a novelty scan each). A user who has never
   signed in (so never ran a worker) accumulates jobs indefinitely.

2. **Worker is fragile and hard to restart.** The local Codex worker runs as a
   Windows Scheduled Task (daily 6am) or is launched manually in a shell. If the
   shell window is closed or the task isn't running, there is no easy in-app way to
   bring it back, and the user has to remember a PowerShell command.

## Goals

- A returning/reconnecting worker generates **only the latest day's inbox**, never
  a backlog of prior days. Superseded days cost zero Codex.
- The worker stays running with minimal babysitting, and when it does stop, the
  `/workers` page shows it clearly and offers a one-action restart.
- No measurable impact on the user's machine when idle.

## Non-Goals

- No browser-launches-the-process control (the custom URL-protocol approach was
  considered and set aside in favor of the hardened scheduled task + shortcut).
- No change to how Codex runs jobs or to the job priority order
  (`inbox_generation` → `novelty_scan` → `viability_check`).
- No re-surfacing of papers from skipped days (existing cross-day dedup already
  keeps them out of future batches).

## Decisions (locked)

- **Backlog policy:** only the latest day. Older unprocessed inbox jobs are
  superseded.
- **Worker control:** harden the scheduled task (auto-restart) + a live status
  panel + a double-click shortcut. No URL-protocol deep link.
- **No machine wake:** drop `-WakeToRun` so the task never wakes the computer from
  sleep; rely on `-StartWhenAvailable` to catch up when next awake/logged in.

---

## Part 1 — Backlog Suppression

### Mechanism

Maintain the invariant: **at most one pending `inbox_generation` job per user — the
newest day.** "Pending" means `status = "queued"` or a stale `running` job (started
before `staleRunningJobStartedBefore()`).

Add a new terminal status string `"superseded"`. Because every job model's `status`
is a free-form Prisma `String` (not an enum), **no database migration is required**.

### Where

Inside the existing transaction of `createInboxGenerationJob`
(`src/lib/jobs/inbox-generation.ts`), **before** the `upsert` of today's job, add an
`updateMany`:

```ts
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

Scoping to `inboxDate < input.inboxDate` guarantees today's job (being upserted in
the same transaction) is untouched, and the stale-`running` cutoff means a genuinely
in-flight job is never killed.

### Why this is sufficient

- The historical multi-day backlog already in the database collapses the next time
  the cron creates a job for that user.
- After that, the invariant holds daily: each new day's creation supersedes all
  older pending days, leaving exactly one (today's).
- A day where the user has **no new arXiv candidates** (cron `continue`s without
  creating a job) does not break the invariant: the prior creation already
  collapsed the backlog to ≤1, so at most one pending day lingers — still no flood.

### Downstream effects (surgical)

- **Claim** (`claimNextInboxGenerationJob`): no change. It already selects only
  `queued`/stale-`running`, so `superseded` is never claimed.
- **Novelty:** no change. Novelty jobs only exist for inboxes that actually
  completed (which requires an online worker), so offline users accumulate none.
- **`listInboxDatesForUser`:** exclude `superseded` job-only dates from the
  `inboxGenerationJob` date query, so the archive dropdown does not show empty
  "skipped" days. (Dates that have generated ideas are unaffected.)
- **`getGeneratedInboxState`:** when the latest job for a requested date is
  `superseded`, return a new state `status: "superseded"`.
- **Inbox page** (`src/app/inbox/[userId]/page.tsx`): render a small, calm notice
  for the `superseded` state — e.g. "Skipped — your worker was offline this day."
  This only appears if a user navigates directly to a superseded date's URL.

### Edge cases

- **Direct navigation to a superseded date:** handled by the `superseded` state
  above.
- **A stale `running` job from a worker that died mid-run:** superseded only once it
  passes the stale cutoff, so it won't block the newest day indefinitely.
- **User who never had a worker (e.g. kristjansolvi03):** their pile collapses to
  one pending day on the next cron job creation; if they later attach a worker they
  get just that day.

---

## Part 2 — Worker Reliability & Control UX

### (a) Harden the scheduled task — `scripts/install-worker.ps1`

- **Triggers:** add an `AtLogOn` trigger for the current user, in addition to the
  existing daily 6am trigger.
- **Settings:**
  - Restart on failure: `-RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)`.
  - `-StartWhenAvailable` (catch up a missed run when next awake/logged in).
  - Unlimited run time: `-ExecutionTimeLimit ([TimeSpan]::Zero)`.
  - `-MultipleInstances IgnoreNew` (never double-run the loop).
  - **Remove `-WakeToRun`** so the task never wakes the machine from sleep.
- Net effect: the worker auto-starts at login and revives itself if it crashes, so
  closing a shell window no longer kills it for good.

### (b) Double-click shortcut

The installer creates a Start Menu **and** Desktop shortcut, `ResearchFinder
Worker.lnk`, that runs the existing `run-worker.ps1` (via
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <runner>`). This is the
reliable manual restart path.

### (c) `/workers` live status panel — `WorkerSetupContent.tsx` + page

- Replace the plain status cell with a prominent badge per worker:
  **online / offline / needs auth / revoked**, using `resolveWorkerStatusForUser`
  (`src/lib/workers/status.ts`) and the `rf` status-style tokens
  (`src/lib/ui/status-styles.ts`).
- **Auto-refresh** the badge roughly every 30s (a small `"use client"` component
  that re-fetches status) so it turns green on its own once the worker starts —
  no manual reload.
- **Offline callout:** when the resolved status is `offline`, show a clear panel
  with two machine-independent restart paths:
  1. *"Double-click the **ResearchFinder Worker** shortcut on your Desktop or Start
     menu."* (created by the installer, with all paths baked in).
  2. A **copy** button for `schtasks /run /tn "ResearchFinder Worker"` — the
     scheduled task has a fixed name, so this one command starts the already-installed
     task immediately on any machine. (No need to reconstruct the node/tsx command or
     serve a binary `.lnk`.)
- Keep the existing "Create worker token" / setup-command flow intact.

### Performance profile (why this is safe on the user's machine)

- **Idle:** a sleeping Node process making one small HTTP poll every
  `RESEARCHFINDER_WORKER_POLL_MS` (default 30s), then sleeping. Negligible CPU,
  ~30–60 MB RAM.
- **Active:** CPU only when a job exists; that work is Codex, identical to today.
- The poll interval is user-tunable via `RESEARCHFINDER_WORKER_POLL_MS`.

### Online threshold

Tighten the "seen recently → online" window in `resolveWorkerStatusForUser` from
10 minutes to **~2 minutes** (4× the default poll), so "offline" reflects reality
quickly. Update `tests/worker-status.test.ts` accordingly.

---

## Testing Strategy

**Part 1 (Postgres-backed):**
- Create 3 `inbox_generation` jobs for one user across 3 ascending dates; call
  `createInboxGenerationJob` for the newest → assert the two older become
  `superseded` and only the newest is claimable (`claimNextInboxGenerationJob`
  returns the newest).
- A fresh (non-stale) `running` older job is **not** superseded.
- `listInboxDatesForUser` excludes superseded-only dates.
- `getGeneratedInboxState` returns `"superseded"` for a superseded date.

**Part 2:**
- Component tests for `WorkerSetupContent`: online / offline / needs-auth / revoked
  rendering and the offline callout (shortcut instruction + copy
  `schtasks /run /tn "ResearchFinder Worker"` present).
- `tests/worker-status.test.ts`: updated 2-minute threshold (online just inside,
  offline just outside).
- Extend `tests/install-worker.test.ts` to assert the generated task includes the
  `AtLogOn` trigger, restart settings, no `-WakeToRun`, and that the shortcut is
  created.

## Build Order

1. **Part 1** — backlog suppression (isolated, server-side, fully testable).
2. **Part 2** — worker reliability & control UX.

## Files Touched (anticipated)

- `src/lib/jobs/inbox-generation.ts` — supersede logic; `listInboxDatesForUser` and
  `getGeneratedInboxState` updates.
- `src/app/inbox/[userId]/page.tsx` — `superseded` state notice.
- `src/lib/workers/status.ts` — 2-minute online threshold.
- `scripts/install-worker.ps1` — task hardening + shortcut creation.
- `src/components/WorkerSetupContent.tsx` (+ a new small client status component) and
  `src/app/workers/page.tsx` — live status panel + offline callout.
- Tests as listed above.
