# SP2 — Local Worker Launcher — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorming)
**Sub-project:** 2 of 2 in the **worker-harness-ops** initiative. Builds on SP1 (worker lanes + multi-worker dashboard, merged). Base branch: `feat/sp2-local-launcher` off `main` (commit `59e097e`, which includes SP1, the nightly cron, and the inbox clamp).

## Goal

Install **one** thing once. From the `/workers` dashboard you flip **Inbox** and **Research** on/off; a local launcher makes your machine match — spawning or killing the right worker processes — so you never hand-edit `.worker.json` or juggle per-worker scheduled tasks again.

## Success criteria

- Toggling a lane in the dashboard starts/stops that lane's worker within one launcher poll (~20s).
- The SP1 per-worker dashboard keeps showing each spawned worker's live status and history (workers keep distinct identities).
- A fresh machine goes from zero to "Inbox + Research workers running" via a single `install-launcher.ps1` invocation.

## Hard constraint (drove the design)

Workers run **as the signed-in user, while logged in, on an awake machine** — the Codex CLI uses per-user auth, so the launcher and its workers **cannot** be a SYSTEM/boot service. The launcher is a per-user logon task, exactly like today's worker task. If the machine is asleep or logged out at 05:00 UTC, the inbox generates once the user is back. SP2 makes workers easy to manage; it cannot make a powered-off laptop work. This is a documented limitation, not a bug.

## Motivation

After SP1 the user can run lane-scoped workers and see what each is doing, but **standing one up/down is still manual**: run `install-worker.ps1` with a token + `-TaskName`, or hand-start a process. The hosted app cannot reach the user's machine, so a UI button cannot spawn a process directly. SP2 closes that gap with an always-on local agent that the dashboard steers via a polled desired-state.

## Design

### A. Data model (Prisma)

1. **`LauncherRegistration`** — the launcher's credential, mirroring `WorkerRegistration`:
   ```prisma
   model LauncherRegistration {
     id         String    @id @default(cuid())
     userId     String
     label      String
     tokenHash  String
     status     String    @default("active")
     lastSeenAt DateTime?
     createdAt  DateTime  @default(now())
     revokedAt  DateTime?
     user       User      @relation(fields: [userId], references: [id])
     @@index([userId])
   }
   ```
   One active launcher per user (the primary install). Token uses the existing `createWorkerToken` / `hashWorkerToken` / `verifyWorkerToken` primitives (`src/lib/jobs/worker-auth.ts`).

2. **`WorkerLaneDesiredState`** — per-user desired lanes:
   ```prisma
   model WorkerLaneDesiredState {
     userId          String   @id
     inboxEnabled    Boolean  @default(false)
     researchEnabled Boolean  @default(false)
     updatedAt       DateTime @updatedAt
     user            User     @relation(fields: [userId], references: [id])
   }
   ```
   Only `inbox` and `research` lanes are launcher-managed (a "both" worker is unnecessary when you can run inbox+research; the `both` lane stays for manual workers).

3. **`WorkerRegistration` gains `launcherManaged Boolean @default(false)`** — distinguishes the launcher's auto-provisioned workers from manually-installed ones, so the launcher reuses exactly one registration per `(userId, lane)` instead of creating sprawl.

New migration `prisma/migrations/<ts>_local_launcher/migration.sql` (timestamp at plan time) creates the two tables and adds the column.

### B. Launcher auth & endpoints

A launcher authenticates with its launcher token (Bearer), validated by a new `findAllowedLauncherByToken(token)` (mirrors `findAllowedWorkerByToken`: scans active non-revoked launchers, `verifyWorkerToken`, gates on `isAllowedGoogleEmail`). Returns `{ id, userId }` or null.

1. **`GET /api/launcher/state`** — returns `{ inbox: boolean, research: boolean }` from `WorkerLaneDesiredState` (defaults both false if no row) **and updates the launcher's `lastSeenAt`** (this doubles as the heartbeat). This is the frequent poll.

2. **`POST /api/launcher/workers/[lane]/token`** — for `lane ∈ {inbox, research}`: ensures the single launcher-managed `WorkerRegistration` for `(userId, lane, launcherManaged: true)` (create if absent with a deterministic label like `"Launcher Inbox worker"`), **rotates its `tokenHash`**, and returns `{ token }`. Called by the launcher only when it is about to (re)spawn that lane's worker. Rotating on each spawn means any orphaned worker from a previous launcher run gets `401` on its next claim and exits cleanly — self-healing crash cleanup. (Assumes one launcher per user; see non-goals.)

All three reuse the allowed-email gate and the existing `readBearerToken`.

### C. The launcher agent — `scripts/researchfinder-launcher.ts`

Config `.launcher.json`: `{ appUrl, launcherToken, codexCommand }` (read via `RESEARCHFINDER_LAUNCHER_CONFIG` or `./.launcher.json`, mirroring the worker's `loadConfig`).

Reconcile loop (default ~20s):
1. `GET /api/launcher/state` → desired lanes (also heartbeats).
2. Maintain `running: Map<lane, ChildProcess>`.
3. For each desired lane **not** running: `POST .../[lane]/token` → write a per-lane `.worker.json` (`{ appUrl, workerToken, codexCommand }`) under the launcher's data dir → `spawn` the **unchanged** worker binary (`node <tsx> scripts/researchfinder-worker.ts`, `env.RESEARCHFINDER_WORKER_CONFIG = perLaneConfigPath`, `cwd = repoPath`) → add to `running`.
4. For each running lane **not** desired: kill the child, remove from `running`.
5. If a child has exited on its own (crash) since last tick: remove it so the next tick respawns.
6. Sleep, repeat.

The worker binary is **unchanged** — SP2 only adds a process that writes its config and manages its lifecycle. The reconcile diff (steps 2-5) is pure logic and is unit-tested with injected `poll`, `provisionToken`, `spawn`, and `kill`.

### D. Dashboard (extends SP1's `/workers`)

- A **Launcher** panel: online/offline (derived from `LauncherRegistration.lastSeenAt` via the existing `ONLINE_WINDOW_MS`), and — if no launcher is registered yet — a button that registers one and shows the one-time `install-launcher.ps1` command (token shown once, like the worker token).
- Two **lane toggles** (Inbox, Research) bound to `WorkerLaneDesiredState`; flipping one calls a `setLaneDesired(lane, enabled)` server action. A small "applies within ~20s" hint.
- The existing SP1 per-worker live cards stay unchanged (they already show the launcher's spawned workers, since those are normal `WorkerRegistration`s).

### E. Install — `scripts/install-launcher.ps1`

Sibling of `install-worker.ps1`: resolves `node`/`codex`/`tsx`/repo path, writes `.launcher.json` (with `appUrl` + launcher token), and registers **one** scheduled task `"ResearchFinder Launcher"` (logon trigger + `-StartWhenAvailable` + restart-on-failure, run as the user) that runs the launcher. The launcher then owns all worker processes. `install-worker.ps1` stays as an advanced/manual fallback. (Per-lane worker configs the launcher writes live under `$LOCALAPPDATA\ResearchFinderLauncher\`.)

### F. Security

- The launcher token is account-scoped, gated by `isAllowedGoogleEmail`, shown once at registration, and revocable from the dashboard (sets `revokedAt`, like worker revoke).
- It is a powerful credential (can provision worker tokens). It lives only in `.launcher.json` on the user's machine, same trust model as today's worker token.
- Per-spawn token rotation means a leaked/old lane token is invalidated the next time that lane is spawned.

### G. Error handling & edge cases

- **Launcher crash** → the scheduled task restarts it; on restart `running` is empty, so it re-provisions + respawns the desired lanes. Orphaned workers from the dead launcher get `401` on next claim (token rotated) and exit. ✔ self-healing.
- **Machine asleep / logged out** → nothing runs; documented constraint (§ Hard constraint).
- **Codex auth** → launcher + workers run as the user (logon task), so Codex auth is present. A SYSTEM service is explicitly **not** used.
- **Desired-state poll fails (network)** → the launcher logs and retries next tick; it does **not** tear down currently-running workers on a transient poll failure (only an explicit "lane off" tears down). Avoids flapping.
- **No launcher registered but toggles set** → toggles just persist; nothing runs until a launcher is installed. Dashboard shows "launcher offline."

### H. Testing

- `findAllowedLauncherByToken`: valid/expired/revoked/disallowed-email.
- `GET /api/launcher/state`: auth, returns flags (incl. default-false when no row), updates `lastSeenAt`.
- `POST /api/launcher/workers/[lane]/token`: auth; ensures **one** launcher-managed registration per `(userId, lane)`; rotates token (old token then fails `verify`); rejects an invalid lane.
- `setLaneDesired` action persists desired state.
- **Reconcile engine** (pure, injected deps): spawns enabled-not-running; kills disabled-running; respawns a crashed child; no teardown on poll failure.
- `install-launcher.ps1`: writes `.launcher.json`, registers the task, run-as-user/logon trigger.
- Dashboard: launcher online/offline + toggle component render and action wiring.

## File structure (anticipated)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `LauncherRegistration`, `WorkerLaneDesiredState`, `WorkerRegistration.launcherManaged` |
| `prisma/migrations/<ts>_local_launcher/migration.sql` | Create |
| `src/lib/v2/domain.ts` | (reuse `WORKER_LANES`; add a `LAUNCHER_LANES = ["inbox","research"]` if helpful) |
| `src/lib/auth/launcher-token.ts` | `findAllowedLauncherByToken` |
| `src/lib/jobs/launcher-registration.ts` | `registerLauncherForUser` |
| `src/lib/launcher/desired-state.ts` | read/write `WorkerLaneDesiredState`; `provisionLaneWorkerToken(userId, lane)` |
| `src/lib/launcher/reconcile.ts` | pure reconcile engine (diff → spawn/kill plan) |
| `src/app/api/launcher/state/route.ts` | GET desired-state + heartbeat |
| `src/app/api/launcher/workers/[lane]/token/route.ts` | POST provision/rotate lane token |
| `scripts/researchfinder-launcher.ts` | the launcher agent (loop + child-process management) |
| `scripts/install-launcher.ps1` | one-time launcher install |
| `src/app/workers/page.tsx`, `src/app/workers/actions.ts`, dashboard components | launcher panel + lane toggles |
| Tests | per § H |

## Non-goals (future)

- **Multiple launchers / machines per user.** Per-spawn token rotation assumes a single launcher. Multi-machine would need per-launcher worker identities; out of scope.
- Multiple same-lane workers (SP1's known limitation; the toggle model is one worker per lane).
- A SYSTEM/boot service (Codex auth constraint).
- Streaming Codex output to the dashboard.
- Auto-updating the launcher binary.

## Open questions

- Exact poll interval (start 20s; could expose via env like the worker's `RESEARCHFINDER_WORKER_POLL_MS`).
- Whether disabling a lane should also `revoke` its launcher-managed `WorkerRegistration` or just stop the process (default: stop the process, keep the registration so history/cards persist; revoke only on launcher revoke). Decide at plan time.
