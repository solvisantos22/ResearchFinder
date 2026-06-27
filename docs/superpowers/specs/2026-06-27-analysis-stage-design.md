# Analysis Stage — Design

Date: 2026-06-27
Status: approved (brainstorm), pending implementation plan
Pipeline: `plan → literature → experiment → analysis → paper` (this is the 4th stage)

## Context

ResearchFinder is becoming a fully autonomous research pipeline that carries a viability-checked
idea to a written paper. The `plan`, `literature`, and `experiment` stages are built, merged, and
deployed. This spec covers the **analysis stage**: the step that turns the experiment's raw outputs
into rigorous, interpreted results that the (future) `paper` stage will write up.

The experiment stage already self-reports `hypothesisOutcomes`, `metrics`, `findings`, `limitations`,
and a `verdict`. The analysis stage's **distinct job** is to go back to the experiment's *raw
outputs* (data files, logs, artifacts left in the workspace) and do real data science on them:
compute proper statistics/significance, generate paper-ready figures and tables, judge the results
against the plan's `successCriteria`, position them against the literature, and produce a structured
analytical interpretation.

## Locked decisions (from brainstorming)

1. **Agentic execution** (the "both" option): a full-access Codex run that crunches the raw data
   AND produces the interpretation + figures/tables in one stage. It follows the **experiment stage
   executor pattern**, not the lightweight literature-synthesis pattern.
2. **Artifacts stay local. No blob storage.** Figures/tables/data are intermediate products that
   only the *workers* consume — the `paper` stage (same machine, same workspace) reads them to
   assemble the final paper file, which the user opens locally. The hosted dashboard does **not**
   render artifacts; it shows the structured analysis text plus a plain list of artifact file paths,
   exactly like the experiment stage does today. (Blob storage was considered and explicitly
   dropped on cost/necessity grounds.)
3. **Same infrastructure as the other stages**: generic `ResearchStageJob` / `ResearchStageArtifact`
   registry, `EXECUTABLE_STAGES` + `STAGE_REGISTRY`, worker executor, source-paper grounding,
   terminal `${stage}_ready` status, detail-page rendering. **No DB schema changes.**

## Goals / Non-goals

**Goals**
- Add `analysis` as an executable stage that runs after `experiment` and becomes the new terminal
  stage (`analysis_ready`) until `paper` is added.
- Produce an `AnalysisResultSchema` artifact: structured interpretation + references to locally
  generated figure/table/data files.
- Reuse the experiment stage's agentic run machinery (workspace, heartbeat, abort, no timeout).

**Non-goals**
- Blob storage / rendering artifacts in the hosted dashboard (dropped).
- The `paper` stage (next sub-project).
- Cross-machine workspace sharing, streaming logs, retries (Sub-project B hardening).

## Execution model

Identical machinery to the experiment stage:

- Full-access Codex via `runCodexAgentic` (`--dangerously-bypass-approvals-and-sandbox`), verified
  working on `codex-cli 0.141.0`.
- **Workspace topology:** the run `--cd`s into the **project workspace root**
  `.research-workspaces/<projectId>/` so the agent can **read** the experiment outputs under
  `experiment/` and **write** its own outputs under `analysis/`. `INPUT.json` is seeded at
  `.research-workspaces/<projectId>/analysis/INPUT.json`.
- **Liveness:** 60s heartbeat to `POST /api/workers/jobs/[jobId]/heartbeat`; abort-kills the process
  tree (win32 `taskkill /T /F`); **no hard timeout** (abort-only stop). On abort → fail the job,
  project stays `aborted`.
- **Inherited constraint (already true for experiment):** all stages of one project must run on the
  **same machine** to share the local workspace. Acceptable for a single research-lane worker.

## Schemas

### `AnalysisResultSchema` (stage output)

| field | type | notes |
|---|---|---|
| `researchProjectId` | string | must match the claimed project |
| `relationToSourcePaper` | string | grounding narrative |
| `successCriteriaAssessment` | `{ criterion: string, status: "met" \| "partially_met" \| "not_met" \| "inconclusive", evidence: string }[]` (≥1) | scores the plan's `successCriteria` against results |
| `statisticalFindings` | `{ description: string, method?: string, value?: string, interpretation: string }[]` | computed stats (significance, effect sizes, CIs…) |
| `keyFindings` | string[] (≥1) | headline analytical conclusions |
| `artifacts` | `{ path: string, caption: string, kind: "figure" \| "table" \| "data", bytes: number }[]` | references to files generated under `analysis/` (local, not uploaded) |
| `comparisonToBaselines` | string | results vs plan baselines / prior work |
| `threatsToValidity` | string[] | limitations of the analysis itself |
| `recommendedNextSteps` | string[] | what to run next |
| `verdict` | `"supports_hypotheses" \| "mixed" \| "refutes_hypotheses" \| "inconclusive"` | overall analytical call |
| `summary` | string | |
| `citations` | `Citation[]` (≥1) | must include the source paper (grounding enforced) |

Conventions match the other stages: `relationToSourcePaper`, `citations` ≥1 with a source-paper
citation, `findings`-style arrays, an enum `verdict`. `artifacts` mirrors the experiment artifact
shape with an added `kind` and `caption` (caption is what the paper stage will use).

### `AnalysisJobInputSchema` (worker input)

Mirrors `ExperimentJobInputSchema`. Fields:

- `jobId`, `userId`, `researchProjectId`
- `idea` (full), `paper` (full)
- `plan` subset: `hypotheses`, `successCriteria`, `metrics`, `baselines`, `experimentalDesign`
- `literature` subset: `positioning`, `gaps`
- `experiment` subset: `hypothesisOutcomes`, `metrics`, `findings`, `limitations`, `verdict`,
  `environment`, `reproductionSteps`, `artifacts` (paths!), `logsExcerpt`, `summary`
- `viability` (nullable)
- `citations`

The claim route reads the **plan + literature + experiment** artifacts for the project and throws if
any is missing (analysis cannot run before experiment completes).

## Data flow

1. Experiment job completes → `completeResearchStageJob` calls `nextExecutableStage("experiment")`
   → now returns `analysis` → creates a queued `analysis` `ResearchStageJob`, project stays
   `running`, `currentStage = analysis`.
2. A research-lane worker claims it → `buildAnalysisJobInput` assembles the input from the three
   upstream artifacts → claim returns `{ type: "research_analysis", id, input }`.
3. Worker `runAnalysisJob`: seeds `analysis/INPUT.json`, builds the prompt, runs `runCodexAgentic`
   with `--cd <projectRoot>` + heartbeat, parses output with `parseResearchStageOutput("analysis", …)`.
4. Worker POSTs the `AnalysisResultSchema` JSON to `/complete` → `completeResearchStageJob` validates
   against `STAGE_REGISTRY.analysis.outputSchema`, enforces `assertCitesSourcePaper`, then (no next
   executable stage yet) sets project status to **`analysis_ready`** and writes the
   `ResearchStageArtifact`.
5. Detail page renders the analysis section (structured fields + artifact-path list).

## Plumbing changes (no DB migration)

| file | change |
|---|---|
| `src/lib/v2/schemas.ts` | add `AnalysisResultSchema` + `AnalysisJobInputSchema` (+ exported types) |
| `src/lib/research/stages.ts` | `EXECUTABLE_STAGES += "analysis"`; `STAGE_REGISTRY.analysis = { outputSchema: AnalysisResultSchema, requiresSourcePaperCitation: true }` |
| `src/lib/v2/domain.ts` | add `analysis_ready` to `RESEARCH_PROJECT_STATUSES` |
| `src/worker/output-validation.ts` | register `analysis: AnalysisResultSchema` in `RESEARCH_STAGE_SCHEMAS` |
| `src/lib/workers/lanes.ts` | add `research_analysis` to `WORKER_JOB_TYPES`, the `WorkerJobType` union, and the `research` lane |
| `src/app/api/workers/jobs/[jobId]/complete/route.ts` | extend `markWorkerJobFailed` branch → `failResearchStageJob` for `research_analysis` |
| `src/app/api/workers/claim/route.ts` | `buildAnalysisJobInput` (reads plan + literature + experiment artifacts) + dispatch branch |
| `scripts/researchfinder-worker.ts` | `runAnalysisJob` + `buildAnalysisPrompt`; dispatch `research_analysis`; reuse `runCodexAgentic` + heartbeat + abort + workspace seeding |
| `src/app/research/[projectId]/page.tsx` | analysis section (verdict badge, successCriteriaAssessment, statisticalFindings, keyFindings, comparison, threats, next steps, artifact paths, citations) |

## Error handling

- Heartbeat liveness + abort (reused): live job never reclaimed; dead worker reclaimed after the
  stale window; abort → job failed, project `aborted`.
- Strict schema validation on completion; malformed output fails the job.
- Source-paper grounding via `assertCitesSourcePaper` (requires a `paper` citation matching the
  source paper).
- Terminal failure → project `failed` via `failResearchStageJob`.

## Testing (mirror experiment stage coverage)

- Schema tests for `AnalysisResultSchema` / `AnalysisJobInputSchema` (valid + key rejections).
- Registry: `analysis` in `EXECUTABLE_STAGES` + `STAGE_REGISTRY`; `nextExecutableStage("experiment")
  === "analysis"`, `nextExecutableStage("analysis") === null`.
- Claim builds the analysis input from the experiment (+plan+literature) artifact; throws if missing.
- Worker `runAnalysisJob` runs `runCodexAgentic` with the right args + workspace, heartbeats, and
  aborts (injected fakes, as in the experiment tests).
- Lifecycle: experiment completion advances to `analysis`; analysis completion → `analysis_ready` +
  artifact persisted; grounding rejection fails the stage.
- Detail page renders the analysis section.

## Out of scope / future

- `paper` stage (next sub-project) — consumes the analysis artifacts to produce the final document.
- Blob storage + dashboard artifact rendering (Sub-project B), streaming logs, retries, cross-machine
  workspaces, re-running a `failed` project.
