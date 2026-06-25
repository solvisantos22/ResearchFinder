# Autonomous Research Harness & Plan Stage — Design

**Date:** 2026-06-25
**Status:** Approved (pending spec review)

## Vision (the whole platform — context only)

ResearchFinder already takes daily arXiv papers → generated ideas → novelty scan → viability check. The next leap is a **fully autonomous research pipeline**: take a viability-checked idea and carry it all the way to a written paper — develop the research, run the experiments, analyse results, and draft the paper, with every step harnessed (recorded, inspectable, resumable) and fully autonomous (no human gates).

The full pipeline decomposes into stages: `plan → literature → experiment → analysis → paper`, plus a cross-cutting **harness** (orchestration spine, artifact store, observability, safety). This is a platform, not a feature — each stage is its own spec → plan → build cycle.

## Scope of THIS sub-project

The **harness spine + the first stage (`plan`)**. Concretely: a `ResearchProject` entity that advances a viable idea through ordered stages fully autonomously, with observability and an abort switch, and one implemented stage that turns a viability result into a structured research plan. No code execution, no web search, no later stages.

## Decisions (locked during brainstorming)

- **Starting point:** harness spine + plan stage (riskiest stage, experiment execution, comes later).
- **Control model:** fully autonomous — no approval gates between stages. The harness still provides live observability and an abort/kill switch.
- **Trigger:** a manual "Develop this" button on an idea. (Auto-start on a positive viability verdict is a deliberate later addition.)

## Cross-cutting invariant: source-paper grounding

The whole project is seeded by exactly one source arXiv paper (`generatedIdea.paper`). To prevent the well-known failure where the pipeline accumulates many references but drops the seminal one it builds on:

1. The source paper rides along **every** stage's input for the life of the project.
2. The `plan` stage output has a required `relationToSourcePaper` field (how the proposed research extends the original).
3. **Any stage that emits citations must include the source paper as a mandatory anchor citation** (`sourceType: "paper"`, matching `sourceId`/`url`), enforced in completion validation — mirroring the existing `assertGeneratedPaperMatchesCandidate` check in inbox generation. This guarantee carries forward so the eventual written paper cannot omit the original.

## Goals

- A `ResearchProject` can be created from a generated idea and runs the `plan` stage autonomously to a clean stopping point.
- Every stage's full input and output is persisted and inspectable.
- The plan is explicitly grounded in the source paper.
- The spine is forward-compatible: adding the next stage requires no rework of the advance logic.

## Non-Goals (later sub-projects)

- Literature grounding, experiment-execution sandbox, analysis, and paper-writing stages.
- Any auto-start trigger.
- File/blob artifact storage (the plan is structured JSON; blobs arrive with the experiment stage).
- Web search or code execution in the `plan` stage.

## Architecture — reuse the worker/Codex job model

Each stage is a **worker job**, identical in shape to the existing `viability_check` / `novelty_scan` jobs. The local Codex worker claims it, runs Codex against a prompt, and posts a structured result to the completion route. The **harness** is the rule: when stage N's job completes, enqueue stage N+1's job. This reuses the claim/complete routes, the stale-job lifecycle (`staleRunningJobStartedBefore`), structured-output validation, and the local Codex runner. No new execution infrastructure.

*(Alternative considered: a separate long-running orchestrator process. Rejected — unnecessary until experiment loops exist; it would duplicate the job lifecycle we already have.)*

## Data model (new Prisma models; `status` stays a free-form `String`)

**`ResearchProject`**
- `id`, `userId`, `generatedIdeaId`, `sourceViabilityJobId` (nullable — the viability job that justified developing it)
- `status`: `running` | `plan_ready` | `aborted` | `failed`
- `currentStage`: `plan` | `literature` | `experiment` | `analysis` | `paper`
- `createdAt`, `updatedAt`
- Relations: `user`, `generatedIdea`, `planJob`, `plan`

**`ResearchPlanJob`** (mirrors `ViabilityJob`)
- `id`, `researchProjectId` (unique), `userId`, `status` (`queued`|`running`|`completed`|`failed`), `claimedByWorkerId`, `inputJson`, `outputJson`, `errorMessage`, `startedAt`, `completedAt`, `createdAt`

**`ResearchPlan`** (the persisted artifact)
- `id`, `researchProjectId` (unique), `planJson` (the full validated `ResearchPlan` object), `createdAt`

Storing the validated plan as `planJson` (rather than over-normalising every array into columns) keeps v1 simple; the Zod schema guarantees shape, and the detail page renders from it.

## Stages + harness advance logic

A stage registry lists stages in order with their (optional) executor. Advance rule, run after a stage job completes inside the completion transaction:
1. Persist the stage artifact (for `plan`: create the `ResearchPlan` row) — with source-paper grounding validated first.
2. Find the next stage in the registry that has a registered executor.
3. If one exists → set `currentStage` to it and enqueue its job. If none exists (the case today, since nothing follows `plan`) → set `status = plan_ready` (clean terminal-for-now).

When the experiment stage is built later, registering its executor makes the harness continue automatically — no change to the advance rule. If a stage job **fails** (Codex error or validation failure), set `ResearchProject.status = failed` and do not advance.

## The `research_plan` stage contract

**Input (built by the claim route, like the viability input):**
- The generated idea (title, summary, expandedExplanation, trajectory, smallestSprint)
- The source paper (id, arxivId, title, abstract, url, authors, categories, publishedAt)
- The viability result for the idea (verdict, summary, feasibility, noveltyRisk, minimumExperiment, blockers) when available
- Existing citations gathered for the idea

**Output (`ResearchPlanSchema`, structured — strict object):**
- `researchProjectId` (echo, validated to match the claimed job)
- `relationToSourcePaper`: how this research extends/builds on the original paper *(required)*
- `hypotheses`: string[] (≥1)
- `experimentalDesign`: string
- `protocolSteps`: ordered string[] (≥1) — the concrete experiment steps
- `datasets`: string[]
- `baselines`: string[]
- `metrics`: string[]
- `successCriteria`: string[] (≥1)
- `computeEstimate`: string
- `risks`: string[]
- `citations`: Citation[] (≥1) — **must include the source paper** as `sourceType: "paper"` with matching `sourceId`/`url`

The Codex prompt mirrors `buildViabilityPrompt`: "return only valid JSON matching this schema," enumerate the fields, and explicitly instruct grounding in and citation of the source paper. Pure reasoning over the supplied context — no new searches.

## Trigger, abort, observability

- **Develop button** on the idea card, alongside the existing "Dispatch viability check" action → server action `developIdea(generatedIdeaId)` → creates a `ResearchProject` (`status: running`, `currentStage: plan`) and enqueues its `ResearchPlanJob`, in one transaction. Idempotent: a second click on an idea that already has a non-aborted project returns the existing project.
- **Abort**: server action sets `ResearchProject.status = aborted`. The harness advance step skips aborted projects; the claim route will not enqueue/serve further stage jobs for them. An in-flight Codex call is allowed to finish; at completion time, if the project is `aborted`, the job is recorded `completed` but no artifact is persisted and the project stays `aborted` (no advance).
- **Observability:**
  - `/research` — list of the user's research projects (idea title, status, current stage, created).
  - `/research/[projectId]` — detail: source idea + source paper, stage/status timeline, each stage job's stored input/output, the rendered plan (with `relationToSourcePaper` shown prominently and the source paper in the citation list), and an Abort button. Reuses `PageShell` + `rf` tokens.

## Worker integration

- New job type `research_plan`.
- Claim priority: `inbox_generation → novelty_scan → viability_check → research_plan` (research projects are long-running and lowest-urgency). Tunable.
- New claim branch builds the `research_plan` input; new completion branch parses `ResearchPlanSchema`, validates source-paper grounding + job identity, persists `ResearchPlan`, and runs the advance rule.
- The local worker gets a `runResearchPlanJob` executor mirroring `runViabilityJob` (write prompt → run Codex → parse/validate → complete), and a `buildResearchPlanPrompt`.
- Worker output-validation gains a `parseResearchPlanOutput`.

## Error handling

- Stale `running` stage jobs reclaimed via the existing `staleRunningJobStartedBefore` cutoff.
- Codex error or schema-validation failure on a stage → stage job `failed`, project `failed` (no advance); surfaced on the detail page.
- Completion guards (mirroring existing jobs): job must be `running` and claimed by the completing worker; output `researchProjectId`/identity must match; source-paper citation must be present — otherwise reject without persisting.

## Testing strategy (Postgres-backed unless noted)

- `developIdea` creates a `ResearchProject` + enqueues a `ResearchPlanJob` atomically; second call is idempotent.
- Claiming returns a well-formed `research_plan` input including the source paper and viability result.
- Completing a `research_plan` job persists the `ResearchPlan`, advances the project to `plan_ready` (no further stage exists), and stores `outputJson`.
- Completion is **rejected** (nothing persisted) when the plan omits the source-paper citation.
- A failed plan job sets the project to `failed`.
- Abort blocks advancement: completing a job for an aborted project does not change it to `plan_ready`.
- `ResearchPlanSchema` validation unit tests (grounding/required fields; rejects missing `relationToSourcePaper` and source-paper citation).
- Worker `parseResearchPlanOutput` unit test.
- Component tests (jsdom): Develop button renders/calls the action; `/research` list + `/research/[projectId]` detail render the key states (running, plan_ready with rendered plan, aborted, failed).

## Build order (within this sub-project)

1. Schemas + domain (`ResearchPlanSchema`, `research_plan` job type, stage enum).
2. Prisma models + migration.
3. Plan job lifecycle (`developIdea`, claim, complete + advance rule + grounding validation).
4. Worker claim/complete routes for `research_plan`.
5. Local worker executor + prompt + output validation.
6. Develop button + abort action.
7. `/research` list + `/research/[projectId]` detail pages.
8. Verification (lint, types, full suite, build).

## Future stages (out of scope — noted for forward-compatibility)

`literature` (deeper related work), `experiment` (sandboxed code execution — the hard infra piece), `analysis` (results → figures/verdict), `paper` (drafting). Each registers an executor in the stage registry and the harness advances into it automatically. The source-paper grounding invariant applies to every stage that emits citations, and is mandatory at the `paper` stage.
