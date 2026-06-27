# Research-Grade Pipeline Redesign — Design

Date: 2026-06-27
Status: approved (brainstorm), pending implementation plans (phased)
Supersedes the behavior (not the infrastructure) of: `plan → literature → experiment → analysis` stages.

## Context

The autonomous research pipeline (`plan → literature → experiment → analysis → paper`) is built and
the first four stages are merged + deployed. The first live end-to-end smoke test exposed a
fundamental quality problem: **the stages produce fast toy demonstrations, not research.**

Concrete evidence from the smoke run (`cmqwofr9n…`): the experiment stage finished in a few minutes
and **fabricated tiny synthetic data** — `correctness_matrix_gsm8k_style_micro.csv` (762 bytes),
`humaneval_style_micro.csv` (512 bytes) — instead of obtaining the real per-model data a
"67 frontier models" study requires. Root causes:

- Both the plan and experiment prompts literally request **"the smallest credible experiment."**
- No mandate to obtain real data; fabricating toy fixtures is treated as acceptable.
- No scale/rigor requirements (datasets, seeds, ablations, statistics).
- A single Codex pass per stage that stops the instant it has *a* number.
- The only gate is JSON-schema validation — nothing judges whether the work is real or good.

## Goal

A **fully autonomous, research-paper-grade agent pipeline** that carries an arXiv-seeded idea to a
**publish-ready research paper**, running for as long as it takes (many hours per project is fine).

## Locked decisions (from brainstorming)

1. **North star = a publish-ready paper.** The whole pipeline serves that deliverable.
2. **Engine = Codex on the user's subscription. No paid LLM API keys.** All *model reasoning* goes
   through Codex (flat-rate, the whole reason for Codex agents). Agents **may** freely use the open
   web and any non-LLM online/data APIs (arXiv, OpenAlex/Semantic Scholar, HuggingFace datasets,
   GitHub, Kaggle, data portals, etc.). They **may not** use paid per-token LLM API keys.
3. **Real, never toy.** Agents must obtain and use real public data/code and do exhaustive, rigorous
   work. Fabricating synthetic stand-ins is a failure, not a shortcut.
4. **Feasibility-gated planning + no-fabrication.** The plan stage must choose a study genuinely
   executable with Codex + web + local compute + public data. The experiment stage must use real
   obtained data; a critic rejects synthetic/toy results and backtracks to the plan to re-scope.
5. **Dedicated critic agent per stage.** Producer and judge are distinct Codex runs. Each critic
   returns `PASS | REDO{feedback} | BACKTRACK{targetStage, feedback}`.
6. **Stage reorder: `literature → plan`** (survey the field, then design a feasible study), then
   `experiment → analysis → paper`.

## Architecture

A **review-gated, backtracking research workflow**. Producer stages:
`literature → plan → experiment → analysis → paper`. Every producer is followed by a dedicated
critic agent that scores the output against explicit, stage-specific criteria and returns one verdict:

- **PASS** → advance to the next stage (or `paper_ready` if it was the paper critic)
- **REDO{feedback}** → re-run the *same* stage with the feedback (this is what makes a stage go deep)
- **BACKTRACK{targetStage, feedback}** → return to a named upstream stage; the critic chooses REDO vs
  BACKTRACK by root cause (deficiency within this stage → REDO; caused by an upstream input →
  BACKTRACK to the stage that owns it)

**Execution model.** Every producer and every critic is a full-access **Codex run on the
subscription** (`runCodexAgentic`), with websearch + local compute, long-running (heartbeat + abort,
no hard timeout — as today). Depth comes from two forces together: (1) prompts that mandate real data
+ exhaustive rigor and forbid "minimal"/fabrication, and (2) the critic loop that refuses to advance
until criteria are met.

## Per-stage producers + critic criteria

### `literature`
- **Producer:** real, broad survey via websearch + scholarly APIs — related works with *verifiable*
  citations, the specific gap the idea fills, **and an inventory of publicly available
  datasets/code/benchmarks** for this direction (feeds feasibility).
- **Critic:** enough real, URL-verifiable sources? gap concrete and real? usable data/code surfaced?
  Hallucinated citations → REDO.

### `plan`
- **Producer:** a concrete, **feasible** study — hypotheses; *named* real datasets/benchmarks with
  availability confirmed; baselines; metrics; **ablations; seeds/repetitions; a statistical-analysis
  plan**; measurable success criteria — all runnable with Codex + web + local compute + public data.
- **Critic:** can this actually run *here*? is it rigorous (ablations/seeds/stats, not one-shot)?
  grounded in the source paper + literature? Infeasible or vague → REDO.

### `experiment`
- **Producer:** obtain the **real** data (download/build from public sources), implement, and run the
  *full* study — all conditions, multiple seeds, real metrics vs baselines — saving raw outputs +
  artifacts. Runs as long as needed.
- **Critic (key gate):** is the data real and provenance-traceable (not `_style_micro` toy)? does
  scale/coverage match the plan? all conditions/seeds complete? Fabricated/infeasible → BACKTRACK to
  `plan` to re-scope; thin → REDO.

### `analysis`
- **Producer:** rigorous statistics on the real outputs — significance, effect sizes, CIs,
  multiple-comparison corrections, robustness checks; publication-quality figures/tables; honest
  success-criteria assessment; comparison to baselines + literature; threats to validity.
- **Critic:** stats correct and appropriate? figures publication-grade? claims supported by the data?
  Data can't support the claims → BACKTRACK to `experiment`.

### `paper`
- **Producer:** assemble a complete academic paper from all upstream artifacts. Output is **LaTeX
  compiled to PDF locally** (agent runs `tectonic`/`pdflatex`). Standard structure: Title, Abstract,
  Intro, Related Work, Method, Experiments, Results, Discussion, Limitations, Conclusion, References —
  with the analysis figures/tables embedded and a novel contribution stated **relative to the source
  paper**.
- **Critic (strictest gate — where "publish-ready" is enforced):** every empirical claim/number
  traces to an analysis result (no unsupported claims, no invented numbers); every citation is real
  and verifiable (URL/DOI resolves); figures/tables present + referenced; novelty vs. source paper
  explicit; method reproducible from the text; the LaTeX **compiles to a PDF**. Writing/structure
  problems → REDO; claims the results don't support → BACKTRACK to `analysis` (or further).
- **Deliverable:** `.tex` + compiled `.pdf` + figures live locally in the workspace (referenced by
  path, consistent with the local-artifacts decision); the dashboard shows metadata + paths + verdict.
- **Bar:** a genuine, submittable workshop/conference-grade draft — real experiments, honest results,
  proper statistics, real citations, reproducible method. Not a guarantee of acceptance.

## Backtracking, budgets, termination

- **Critic verdict (structured):** per-criterion scorecard + one decision (`PASS|REDO|BACKTRACK`).
  Critics run as fresh Codex agents seeing only the artifact + criteria, instructed to be adversarial
  and default to rejection when unsure (anti-rubber-stamp).
- **Feedback carry:** the feedback string is attached to the re-dispatched producer's input; a
  per-project **feedback log** accumulates so a producer sees every prior critique.
- **Backtrack invalidates downstream:** backtracking to stage X marks artifacts for stages after X
  superseded; they re-run fresh once X passes again, so a project always ends mutually consistent.
- **Budgets (defaults, configurable):** per stage visit up to **3 REDOs**; per project up to **5
  BACKTRACKs** and a hard cap of **~30 total producer runs**; optional wall-clock cap (off by
  default). Budgets exist only to stop infinite ping-pong; within them the system grinds freely.
- **Termination:** `paper` critic PASS → **`paper_ready`**; any budget exhausted → **`needs_review`**
  (all artifacts + the full feedback log preserved — never a silent toy result); abort → `aborted`.

## State model, orchestration, observability

Keep the existing `ResearchStageJob` / `ResearchStageArtifact` registry as the **producer layer** and
extend it (this requires a **DB migration**):

- **Critic jobs:** add a critic job per stage (`${stage}_critic`) so producers and critics are
  distinct Codex runs.
- **Per-attempt tracking:** jobs gain `attempt`, the `feedback` that spawned them; critics store a
  `verdict` (`PASS|REDO|BACKTRACK`) + per-criterion scorecard.
- **Project level:** `currentStage`; statuses add `needs_review` (+ existing `paper_ready`); budget
  counters (`producerRunsUsed`, `backtracksUsed`); an accumulated feedback log per stage.
- **Artifacts:** latest-per-stage; on BACKTRACK to X, artifacts after X marked superseded and re-run;
  history kept for observability.

**Orchestration (the state machine)** replaces today's forward-only advance: *producer completes →
enqueue its critic; critic completes → route:* `PASS`→next producer (or `paper_ready`); `REDO`→same
producer, attempt+1, with feedback (if under per-stage cap); `BACKTRACK`→invalidate downstream +
re-enqueue the target producer with feedback (if under backtrack/total caps); any cap hit →
`needs_review`. Producers and critics both reuse `runCodexAgentic` + heartbeat + abort. The
claim/complete worker routes extend to critic job types and the new routing.

**Observability:** the dashboard shows the *loop* — per stage: attempts, each critic verdict +
scorecard, accumulated feedback, backtracks taken, budget used, artifact/PDF paths, current status.
Essential now that a run loops for hours.

## Build phasing

Too big for one plan. Each phase is its own spec→plan→build cycle; build in order:

1. **Orchestration spine** — state model + migration + routing state machine + critic-job plumbing
   (the new backbone; critics can be stubs initially).
2. **Critic agents** — per-stage criteria + verdict schemas, wired into the loop.
3. **Producer overhaul** — rewrite prompts for real-data/rigor/feasibility/no-fabrication across
   `literature/plan/experiment/analysis`; apply the `literature→plan` reorder.
4. **Paper stage** — LaTeX/PDF producer + strict critic.
5. **Observability** — the loop dashboard.

Phase 1 is the focus of the next implementation plan.

## Error handling

- Heartbeat liveness + abort (reused) for every producer and critic.
- Strict schema validation on producer outputs (now with `CoercibleString` leniency from the prior
  fix) and on critic verdicts.
- Source-paper grounding preserved (every stage rides + cites the source paper).
- Budget exhaustion → `needs_review` (not `failed`), artifacts + feedback preserved.
- Terminal infrastructure failure (Codex crash after retries) → `failed`, as today.

## Testing

- State-machine routing: PASS advances; REDO re-enqueues same stage attempt+1; BACKTRACK invalidates
  downstream + re-enqueues target; budget caps → `needs_review`; loop-avoidance (no infinite
  ping-pong).
- Critic verdict schema (valid + key rejections); critic-job claim/complete + worker dispatch.
- Migration data-preservation (existing projects/artifacts intact).
- Per-stage criteria gating (a fabricated/toy experiment artifact → BACKTRACK to plan).
- Postgres-backed lifecycle tests (TEST_DATABASE_URL on port 5432, long `--testTimeout`).

## Out of scope / future

- Paid LLM API keys; cloud GPU provisioning.
- Multi-machine workspace sharing (all stages of a project still run on one machine — the local
  workspace is shared, as today).
- Re-running a `needs_review` / `failed` project from the dashboard (still deferred).
- Rendering artifacts/PDF inside the hosted dashboard (artifacts stay local, opened by the user).
