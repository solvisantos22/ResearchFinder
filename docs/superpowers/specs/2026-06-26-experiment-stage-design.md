# Experiment Stage (Local Agentic Execution) — Design

**Date:** 2026-06-26
**Status:** Approved (design); pending implementation plan
**Sub-project:** A — agentic execution foundation + minimal experiment stage

## Goal

Add `experiment` as the third executable stage of the autonomous research pipeline. When a
project reaches it, a worker runs **Codex (Claude Code) in full agentic mode inside a
per-experiment workspace on the local machine** — Codex writes code, installs dependencies,
runs the experiment, iterates, and emits a structured, source-paper-grounded
`ExperimentResult`. This makes `plan → literature → experiment` a real, executing pipeline.

## Context

ResearchFinder advances a viability-checked idea through `plan → literature → experiment →
analysis → paper` via a generic stage registry (`ResearchStageJob` / `ResearchStageArtifact`
keyed by `stageType`). The `plan` and `literature` stages are built, merged, and deployed.
Adding a new executable stage is now mostly generic plumbing — except that a *real* execution
stage needs new infrastructure, which is why it was deliberately deferred as "the hard infra
piece."

**Key architectural fact:** the worker already runs Codex locally on the user's machine. Today
it invokes Codex purely as a text→JSON generator (`codex exec --json --skip-git-repo-check
--output-last-message <file> -`, prompt on stdin), constraining behavior through the prompt.
Codex `exec` is a full agent, so an executing experiment stage is feasible by invoking Codex
with the right flags (workspace target + full access) and a longer-lived job model.

## Locked decisions

1. **Scope: real execution** (not a reasoned/simulated experiment).
2. **Execution strategy: local agentic Codex in a per-experiment workspace** (reuses the
   existing local worker; the user's machine is the compute).
3. **Sandbox posture: full access (no sandbox)** — Codex runs experiment code with no sandbox
   restrictions. The user opted in; each run is still scoped to its own workspace dir for
   inspectability.
4. **No hard runtime cap** — experiments run as long as they are alive. The only stop is the
   user's **abort** action, which tree-kills Codex. Liveness (not a timer) prevents a long
   experiment from being mistaken for a dead worker.
5. **Decomposition: this is Sub-project A.** Artifacts in v1 = the structured `ExperimentResult`
   + truncated run log + metrics + a file manifest, stored in the DB artifact; the actual
   workspace files stay on the local machine. **Sub-project B (later)** = blob/artifact
   storage, isolation hardening, streaming observability, partial-result/retry.

## Architecture & data flow

`EXECUTABLE_STAGES = ['plan', 'literature', 'experiment']`. Everything downstream of the
registry is already generic, so:

1. Literature completes → `nextExecutableStage('literature') === 'experiment'` → the harness
   enqueues a `research_experiment` job; project `status: running`, `currentStage: experiment`.
2. A **research**/**both**-lane worker claims it. `buildExperimentJobInput` assembles the input
   from prior artifacts: idea + source paper + the **plan** artifact (hypotheses, experimental
   design, protocol steps, datasets, baselines, metrics, success criteria) + the **literature**
   artifact (positioning, gaps) + viability context + the idea's citations.
3. The worker creates a per-experiment **workspace dir**, seeds it with the inputs and a result
   contract, and invokes **Codex in agentic full-access mode** pointed at that workspace
   (`--cd`). Codex implements and runs the experiment and emits the `ExperimentResult` as its
   final message. A heartbeat loop runs concurrently.
4. The worker validates the result against `ExperimentResultSchema`, POSTs it to the completion
   route → `completeResearchStageJob` enforces source-paper grounding, persists the `experiment`
   artifact, and advances the project to **`experiment_ready`** (terminal until the analysis
   stage exists).

**Reused unchanged:** the generic claim/complete/advance machinery, the abort-gated advance
transaction, grounding enforcement, and the UI artifact-rendering pattern.

## Component 1 — Agentic Codex runner & workspace

Add a sibling to `runCodex` in `src/worker/codex-runner.ts`:
**`runCodexAgentic(promptFile, { workspaceDir })`**, differing from `runCodex` in four ways:

- **Full-access agentic flags + workspace targeting:** the arg builder adds the install's
  bypass-sandbox/approvals flag and `--cd <workspaceDir>`, and spawns with `cwd: workspaceDir`.
  Keeps `--json --output-last-message <file>` so the structured final JSON is still captured.
  Keeps `--skip-git-repo-check`. (The exact full-access flag is install-specific and is pinned
  by the spike below.)
- **No wall-clock timeout.** The child is killable on demand (tree-kill via the launcher's
  Windows `taskkill /PID <pid> /T /F` pattern; `child.kill()` elsewhere) but is killed **only**
  on abort, never on a timer.
- **Run log:** streams Codex's `--json` event stream to `<workspace>/codex-run.log` for
  observability and inclusion (truncated) in the artifact.
- **Workspace lifecycle:** `<root>/<researchProjectId>/experiment/`, root configurable via env
  (default a git-ignored `.research-workspaces/`). Seeded with `plan.json`, `literature.json`,
  `idea.json`, and a `RESULT-CONTRACT.md`. **Not deleted** after the run (inspectable);
  retention/cleanup is Sub-project B.

**De-risking spike (first implementation task):** invoke `runCodexAgentic` on a trivial prompt
— "create `hello.py` that prints a number, run it, then emit `{ran:true, value:<n>}`" — and
confirm Codex writes + executes + returns valid JSON on the real install. This pins the flag
contract before the stage is built around it.

## Component 2 — Long-running job model (heartbeat + abort, no timer)

- **Schema:** add `heartbeatAt DateTime?` to `ResearchStageJob` (migration).
- **Heartbeat endpoint:** `POST /api/workers/jobs/[jobId]/heartbeat` (worker-token auth,
  ownership-checked). Sets `heartbeatAt = now` and returns `{ aborted: boolean }` (true when the
  project's status is `aborted`).
- **Worker loop:** while `runCodexAgentic` runs, a background ping every ~60s. If a ping returns
  `aborted: true`, the worker tree-kills Codex and stops — no completion posted. A transient
  heartbeat network error is logged and the run continues (no kill on a blip).
- **Stale-claim fix:** in `claimNextResearchStageJob`, change the reclaim predicate from
  "`startedAt <= staleStartedBefore`" to measure against **`coalesce(heartbeatAt, startedAt)`**,
  expressed in Prisma as `OR: [{ heartbeatAt: { lte: stale } }, { heartbeatAt: null, startedAt:
  { lte: stale } }]`. A live experiment heartbeating every 60s is never >30 min stale → never
  reclaimed; a worker that dies stops heartbeating → its job is recoverable after the existing
  `STALE_RUNNING_JOB_TIMEOUT_MS` (30 min). Short stages (plan/literature) don't heartbeat and
  fall back to `startedAt` exactly as today — no behavior change.

No new tunables, no kill clock.

## Component 3 — Schemas & grounding

Two new strict Zod schemas in `src/lib/v2/schemas.ts` (non-empty arrays; source-paper citation
required), following the plan/literature pattern:

- **`ExperimentJobInputSchema`** (worker input): `jobId, userId, researchProjectId, idea, paper`;
  the **plan** subset (`relationToSourcePaper, hypotheses, experimentalDesign, protocolSteps,
  datasets, baselines, metrics, successCriteria`); a **literature** subset (`positioning,
  gaps`); optional viability context; `citations[]` from the idea. Built by
  `buildExperimentJobInput`, which reads the plan + literature artifacts and throws if either is
  missing.
- **`ExperimentResultSchema`** (stored artifact):
  - `researchProjectId`
  - `relationToSourcePaper` (grounding narrative)
  - `implementationSummary`, `environment` (deps/runtime, for reproducibility)
  - `hypothesisOutcomes[]`: `{ hypothesis, outcome: supported | refuted | inconclusive, evidence }`
  - `metrics[]`: `{ name, value, unit?, baseline? }`
  - `findings[]`, `limitations[]`
  - `artifacts[]`: file manifest `{ path, description, bytes }`
  - `logsExcerpt` (truncated run log), `reproductionSteps[]`
  - `verdict: success | partial | failed`, `summary`
  - `citations[]` (≥1) — must cite the source paper

**Grounding:** the registry entry sets `requiresSourcePaperCitation: true`; the existing generic
`assertCitesSourcePaper` enforces it on completion — no new grounding code.

**Storage (v1):** the structured result + truncated logs/metrics + manifest go in `artifactJson`;
large files stay in the local workspace (paths recorded). Blob upload is Sub-project B.

## Component 4 — Stage plumbing

Mirrors the literature stage:

- `src/lib/research/stages.ts`: add `'experiment'` to `EXECUTABLE_STAGES`; add the
  `STAGE_REGISTRY` entry `{ outputSchema: ExperimentResultSchema, requiresSourcePaperCitation:
  true }`. **Refactor the duplicated executable-stage literal union** into a shared
  `type ExecutableStage = (typeof EXECUTABLE_STAGES)[number]`, used by the registry key type, the
  cast in `research.ts`, and `RESEARCH_STAGE_SCHEMAS` in `output-validation.ts`.
- `src/lib/v2/domain.ts`: add `'experiment_ready'` to `RESEARCH_PROJECT_STATUSES` (and verify
  `'literature_ready'` is present; add if missing).
- `src/worker/output-validation.ts`: add `experiment: ExperimentResultSchema` to
  `RESEARCH_STAGE_SCHEMAS`.
- `src/lib/workers/lanes.ts`: add `'research_experiment'` to `WORKER_JOB_TYPES` and to the
  `research` + `both` lanes.
- `src/app/api/workers/claim/route.ts`: add the `buildExperimentJobInput` branch (reads plan +
  literature artifacts) and include `research_experiment` in the lane check; returns
  `type: research_experiment`.
- `src/app/api/workers/jobs/[jobId]/complete/route.ts`: widen the `WorkerJobType` union with
  `research_experiment`; route its failures to `failResearchStageJob`. (`resolveJobType` /
  completion are already generic.)
- `scripts/researchfinder-worker.ts`: allow `research_experiment` in the claim parser; add
  `runExperimentJob` (create/seed the workspace, build the prompt with plan + literature + the
  result contract, call `runCodexAgentic`, run the heartbeat loop, parse via
  `parseResearchStageOutput('experiment', …)`, assemble the `ExperimentResult` with manifest +
  truncated logs, return).
- `prisma/`: one migration adding `heartbeatAt` to `ResearchStageJob`. No new tables.
- `src/app/research/[projectId]/page.tsx`: an experiment section (verdict, hypothesis outcomes,
  metrics table, findings, limitations, file manifest, reproduction steps, citations); the
  timeline already renders all five stages.

## Error handling

- Codex crash / non-zero exit → worker fails the job (`failResearchStageJob`) with a stderr/log
  excerpt → project `failed`.
- Output doesn't match `ExperimentResultSchema` → the same failure path the plan/literature
  stages already use (no new logic).
- Missing plan or literature artifact → `buildExperimentJobInput` throws (like literature today).
- Abort mid-run → tree-kill + stop (Component 2).
- Sustained heartbeat network partition → rare double-run risk; logged, not engineered around in
  v1.

## Testing

TDD per task. Postgres-backed tests run on local port 5432 with `--no-file-parallelism`; verify
the branch-relevant subset (the full suite hangs — known infra issue).

- **Unit:** `ExperimentResultSchema` / `ExperimentJobInputSchema` (valid / invalid / grounding);
  `stages.ts` (`nextExecutableStage('literature') === 'experiment'`,
  `nextExecutableStage('experiment') === null`, the `ExecutableStage` type); `runCodexAgentic`
  **arg-builder** test (full-access flag, `--cd`, no timeout) like the existing
  `codex-runner.test.ts`; `runExperimentJob` with an injected fake runner (workspace seeding,
  prompt includes plan + literature, manifest built).
- **Postgres:** heartbeat endpoint (updates `heartbeatAt`, returns `aborted`); **staleness**
  (fresh heartbeat → not reclaimed despite old `startedAt`; stale heartbeat → reclaimed; null
  heartbeat → `startedAt` fallback); claim builds experiment input from artifacts; completion
  advances `literature → experiment` and `experiment → experiment_ready`; grounding rejection;
  full lifecycle + abort.
- **UI:** experiment section + timeline render.
- **Spike:** a one-time manual verification against the real Codex install (not an automated
  test).

## Out of scope (Sub-project B)

Blob/artifact storage for large outputs (plots, datasets, model weights); stronger isolation
(containerization, resource/network limits); streaming/real-time observability of a running
experiment; partial-result capture and retry semantics; workspace retention/cleanup policy; the
`analysis` and `paper` stages.

## Open risks

- **Codex flag contract** (full-access + `--cd`) is install-specific — pinned by the spike before
  building.
- **Full access** means LLM-generated code runs unsandboxed on the user's machine; mitigated only
  by per-experiment workspace scoping and the user's explicit opt-in.
- **Reproducibility** depends on Codex recording its environment/deps faithfully; the result
  contract instructs it to, but it is not independently verified in v1.
