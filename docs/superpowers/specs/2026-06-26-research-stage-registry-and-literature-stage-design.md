# Research Stage Registry + Literature Stage — Design

**Date:** 2026-06-26
**Status:** Approved (pending spec review)

## Context (where this fits)

ResearchFinder's autonomous research pipeline is `plan → literature → experiment → analysis → paper`, plus a cross-cutting harness. The **harness spine + plan stage** are built and merged: a `ResearchProject` advances a viable idea through ordered stages; each stage is a Codex worker job that posts structured output; `completeResearchPlanJob` currently hardcodes the terminal `plan_ready` with an explicit note that "a later sub-project replaces this with enqueue-the-next-stage."

This sub-project builds the **next stage (`literature`)** and, in doing so, **generalizes the per-stage plan code into a stage registry** so the remaining stages (experiment, analysis, paper) slot in without further harness rework.

## Scope of THIS sub-project

1. Refactor the plan-specific data model + lifecycle into a **generic stage model + registry** (data-preserving migration of existing plan rows).
2. Add the **literature stage**: server-side scholarly retrieval (reusing the novelty machinery) → Codex synthesizes a structured literature review grounded in the retrieved papers + the source paper.

Literature and the generalization are tightly coupled (literature is the first consumer of the registry, and the chosen approach is to generalize now), so they are one spec → plan → build cycle.

## Non-goals (later sub-projects)

- The **experiment** stage (sandboxed code execution — the hard infra piece), analysis, and paper stages. They are registered later as registry entries.
- Any auto-start trigger (development is still the manual "Develop this" action).
- Citation-existence verification (validating that each `related_work` citation URL matches a retrieved-evidence URL) — noted as a future hardening.
- File/blob artifact storage (arrives with the experiment stage).

## Decisions (locked during brainstorming)

- **Scope:** literature stage only; experiment stays deferred.
- **Retrieval:** reuse the scholarly retrieval (`buildNoveltyQueries` + `gatherNoveltySourceEvidence`: arXiv + OpenAlex + Semantic Scholar) server/worker-side, then Codex synthesizes. Not Codex's own web search; not reasoning-only.
- **Architecture:** generalize to a stage registry **now** (rather than mirroring the plan tables per stage).

## Cross-cutting invariant: source-paper grounding (reused)

The project is seeded by exactly one source arXiv paper (`generatedIdea.paper`). Every stage that emits citations must include the source paper as a mandatory anchor citation (`sourceType: "paper"`, matching `sourceId`/`url`), enforced in completion validation by the existing `assertCitesSourcePaper`. The literature stage adds a required `relationToSourcePaper` field, mirroring the plan stage.

## Architecture — generic stage model + registry

Each stage remains a worker job claimed by the local Codex worker. The change is that the job/artifact tables and the lifecycle become **stage-generic**, keyed by a `stageType` discriminator, and a registry holds per-stage metadata (output schema, grounding requirement, input builder) plus the stage ordering.

### Data model (Prisma; `status`/`stageType`/`currentStage` stay free-form `String`)

Replace `ResearchPlanJob` and `ResearchPlan` with:

**`ResearchStageJob`** (replaces `ResearchPlanJob`)
- `id`, `researchProjectId`, `userId`, `stageType` (`plan|literature|experiment|analysis|paper`), `status` (`queued|running|completed|failed`), `claimedByWorkerId`, `inputJson`, `outputJson`, `errorMessage`, `createdAt`, `startedAt`, `completedAt`, `updatedAt`
- `@@unique([researchProjectId, stageType])` — one job per stage per project
- `@@index([userId, status, createdAt, id])`, `@@index([claimedByWorkerId, status])`
- Relations: `researchProject` (onDelete Cascade), `user` (onDelete Cascade)

**`ResearchStageArtifact`** (replaces `ResearchPlan`)
- `id`, `researchProjectId`, `stageType`, `artifactJson`, `createdAt`
- `@@unique([researchProjectId, stageType])`
- Relation: `researchProject` (onDelete Cascade)

**`ResearchProject`** — drop the `planJob ResearchPlanJob?` and `plan ResearchPlan?` relations; add `stageJobs ResearchStageJob[]` and `stageArtifacts ResearchStageArtifact[]`. `status` and `currentStage` stay strings.

### Migration (data-preserving)

A single migration `*_research_stage_registry`:
1. Create `ResearchStageJob` and `ResearchStageArtifact`.
2. Copy forward existing data:
   - `INSERT INTO "ResearchStageJob" (...) SELECT ..., 'plan' AS "stageType" FROM "ResearchPlanJob";`
   - `INSERT INTO "ResearchStageArtifact" (id, researchProjectId, 'plan', planJson AS artifactJson, createdAt) SELECT ... FROM "ResearchPlan";`
3. Drop `ResearchPlanJob` and `ResearchPlan`.

This preserves any existing plan-stage rows regardless of whether prod has data. No BOM in the migration file (per the prior `55ee5b8` fix).

### Stage registry + generic advance

New module `src/lib/research/stages.ts`:
- `RESEARCH_STAGES = ["plan", "literature", "experiment", "analysis", "paper"] as const`; `type ResearchStage`.
- `EXECUTABLE_STAGES: ResearchStage[] = ["plan", "literature"]` — stages with a worker executor today.
- A registry mapping each executable stage → `{ outputSchema, requiresSourcePaperCitation: boolean, buildInput(tx, project): Promise<object> }`.
- `nextExecutableStage(after: ResearchStage): ResearchStage | null` — next stage in `RESEARCH_STAGES` order that is in `EXECUTABLE_STAGES`.

The hardcoded `plan_ready` becomes a generic `advanceAfterStage(tx, project, completedStage, parsedOutput)`:
1. Validate source-paper grounding (when the registry entry requires it), then persist the `ResearchStageArtifact` (`stageType = completedStage`, `artifactJson = parsedOutput`).
2. `next = nextExecutableStage(completedStage)`.
3. If `next` → set `currentStage = next`, `status = "running"`, and create a `queued` `ResearchStageJob` for `next` (its `buildInput` may read prior artifacts in the same transaction — e.g. literature reads the plan artifact).
4. Else → `status = "${completedStage}_ready"` (terminal-for-now).

All advance writes stay abort-gated via a conditional `updateMany` on `status: { not: "aborted" }` (as the current code does), so an abort committing concurrently is never resurrected. A failed stage job sets `ResearchProject.status = "failed"` and does not advance.

**Net effect:** plan now flows `plan → literature → literature_ready` automatically. Adding experiment later is: append it to `EXECUTABLE_STAGES` + a registry entry — no advance-logic change.

## The literature stage contract

**Input** (`buildInput` for literature, assembled at enqueue inside the advance transaction):
- `researchProjectId` (echo)
- the generated idea (title, summary, expandedExplanation, trajectory, smallestViabilitySprint)
- the source paper (id, arxivId, title, abstract, url, authors, categories, publishedAt)
- the completed **plan artifact** (hypotheses, experimentalDesign, protocolSteps, metrics, …) so retrieval targets the actual proposed research

Retrieval is **not** done at enqueue (keeps enqueue fast/deterministic); the worker executor performs it at run time.

**Retrieval** (worker executor, reusing the novelty machinery):
1. Build queries with `buildNoveltyQueries` (idea + paper), augmented with plan hypotheses/keywords.
2. `gatherNoveltySourceEvidence(queries)` → arXiv + OpenAlex + Semantic Scholar, with the existing graceful per-adapter failure and dedup.
3. Pass the deduped evidence + context into the Codex prompt; Codex selects, synthesizes, and cites from the retrieved set + the source paper.
4. If every source fails (zero evidence), Codex still synthesizes from the plan + source paper — degraded, not failed (source-paper grounding still holds).

**Output `LiteratureReviewSchema`** (strict object, mirrors `ResearchPlanSchema` conventions; reuses `CitationSchema`):
- `researchProjectId` (echo, validated to match the claimed job)
- `relationToSourcePaper` (non-empty — carries the grounding invariant)
- `relatedWorks`: array (≥1) of `{ title, summary, relationToProposed }`
- `themes`: string[] (≥1) — thematic clusters of the surveyed literature
- `gaps`: string[] (≥1) — open problems the proposed research addresses
- `positioning`: non-empty — how the proposed research differs from / extends the retrieved literature
- `citations`: `Citation[]` (≥1) — **must include the source paper** as `sourceType: "paper"` with matching `sourceId`/`url`; related works cited as `sourceType: "related_work"`. Grounding enforced by the reused `assertCitesSourcePaper`.

The Codex prompt mirrors `buildResearchPlanPrompt`: "return only valid JSON matching this schema," enumerate the fields, supply the retrieved evidence + plan + source paper, and explicitly instruct grounding in and citation of the source paper.

## Worker + route generalization

Collapse the per-stage worker path into a generic one keyed by `stageType`:
- `claimNextResearchStageJob({ userId, workerId })` returns the next executable `ResearchStageJob` (priority stays lowest, after `viability_check`); replaces `claimNextResearchPlanJob`. The **research lane** (`src/lib/workers/lanes.ts`) covers all research-stage jobs.
- The local worker's `runResearchStageJob(job)` dispatches on `stageType` → plan executor (existing logic moved over) | literature executor (new: queries → gather evidence → Codex → output). Each builds its prompt and parses its schema via the registry.
- `completeResearchStageJob({ jobId, workerId, output })` → look up the job's `stageType` → parse via the registry's schema → identity + grounding guards → persist artifact → `advanceAfterStage`. Replaces `completeResearchPlanJob`.
- `failResearchStageJob` mirrors the current `failResearchPlanJob` (generic).
- `parseResearchStageOutput(stageType, raw)` (worker output-validation) keyed by the registry schema; replaces `parseResearchPlanOutput`.
- The worker job-log records `stageType` for readable observability (e.g. label `research_plan` / `research_literature`).

The claim/complete HTTP routes for research jobs become stage-generic (they already delegate to the lifecycle functions; the change is the function names + the `stageType` carried through).

## Trigger, abort, observability

- **Develop button** and `developIdea` are behaviorally unchanged (create the `ResearchProject` with `status: running`, `currentStage: plan`, and enqueue the plan stage). The only implementation change is that it now creates a `ResearchStageJob` with `stageType: "plan"` instead of the dropped `ResearchPlanJob`. Idempotency (a second click returns the existing non-aborted project) is preserved.
- **Abort** is unchanged (`status = aborted`); the generic advance + claim skip aborted projects.
- **`/research/[projectId]`** renders a **stage timeline** from `stageJobs` + `stageArtifacts`: each stage in `RESEARCH_STAGES` with its status (not-started / queued / running / completed / failed) and stored input/output, plus dedicated renderers for the plan artifact (existing) and the literature artifact (related works, themes, gaps, positioning, citations with the source paper highlighted). `relationToSourcePaper` stays prominent. `getResearchProjectDetail` switches to including `stageJobs` + `stageArtifacts`.
- **`/research`** list shows `currentStage` + status; the status label handles `literature_ready`.

## Error handling

- Stale `running` stage jobs reclaimed via the existing `staleRunningJobStartedBefore` cutoff.
- Codex error or schema-validation failure on a stage → stage job `failed`, project `failed` (no advance); surfaced on the detail page.
- Completion guards (mirroring existing jobs): job must be `running` and claimed by the completing worker; output `researchProjectId`/identity must match; required source-paper citation must be present — otherwise reject without persisting.
- Retrieval degrades gracefully (per-adapter try/catch already exists); zero evidence does not fail the stage.

## Testing strategy (Postgres-backed unless noted)

- Generic model persistence; `@@unique([researchProjectId, stageType])` enforced.
- `advanceAfterStage`: completing the plan stage enqueues a literature `ResearchStageJob` and sets `currentStage = literature`, `status = running`; completing literature sets `literature_ready` (no experiment executor); abort blocks advancement.
- `developIdea` still creates a plan-stage job against the generic model; second call idempotent.
- Claiming returns a well-formed literature input including the plan artifact and source paper.
- Completing a literature job persists the artifact and advances; **rejected** (nothing persisted) when the source-paper citation is missing.
- A failed stage job sets the project to `failed`.
- `LiteratureReviewSchema` unit tests (required fields, grounding; rejects missing `relationToSourcePaper` / source-paper citation).
- Worker `parseResearchStageOutput` unit tests (plan + literature).
- Literature executor evidence assembly with mocked fetch (queries built; evidence deduped; passed to the prompt).
- Component tests (jsdom): `/research/[projectId]` renders the stage timeline + literature artifact across states (running, literature_ready, failed, aborted).

## Build order (within this sub-project)

1. Schemas + stage registry (`LiteratureReviewSchema`, `RESEARCH_STAGES`, `EXECUTABLE_STAGES`, registry, `nextExecutableStage`).
2. Generic Prisma models + data-preserving migration.
3. Generic lifecycle (`developIdea` retargeted; `claimNextResearchStageJob`, `completeResearchStageJob` + `advanceAfterStage` + grounding; `failResearchStageJob`) — migrate plan logic into the generic functions and delete the plan-specific ones.
4. Generic worker claim/complete routes for research stages.
5. Worker executor dispatch (plan moved + literature new: queries → gather evidence → Codex → output) + prompts + `parseResearchStageOutput` + lane mapping.
6. UI: generic stage timeline + literature artifact renderer; `getResearchProjectDetail` update.
7. Verification (eslint, tsc, full suite on Postgres, build).

## Future stages (out of scope — forward-compatibility)

`experiment` (sandboxed code execution — the hard infra piece, brings blob artifacts), `analysis`, `paper`. Each is added by appending to `EXECUTABLE_STAGES` + a registry entry; the generic advance carries the project forward automatically. The source-paper grounding invariant applies to every citation-emitting stage and is mandatory at the `paper` stage.
