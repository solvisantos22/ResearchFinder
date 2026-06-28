# Research-Grade Pipeline Redesign — Phase 2 (Real Critic Agents) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase-1 always-generic stub critic with real, per-stage adversarial criteria so each critic actually judges its stage's artifact (and the relevant upstream artifacts) and returns a meaningful PASS|REDO|BACKTRACK.

**Architecture:** All stage-specific critic content lives in one new registry (`src/lib/research/critic-criteria.ts`): per-stage criteria + routing guidance, rendered into the `criteria` string the claim route already ships to the worker. The claim route additionally attaches the live **upstream stage artifacts** so cross-stage criteria ("scale matches the plan", "claims supported by the experiment") are checkable. `CriticVerdictSchema` is hardened so a BACKTRACK can only target a strictly-upstream stage. The worker writes the upstream artifacts into the critic workspace and the (already generic) critic prompt references them. The orchestration spine, verdict routing, and job plumbing from Phase 1 are unchanged.

**Tech Stack:** TypeScript, Next.js App Router (worker claim/complete routes), Zod (`strictObject` + `superRefine`), Prisma/Postgres, Vitest (+ Postgres-backed route/lifecycle tests), the tsx worker (`scripts/researchfinder-worker.ts`), Codex CLI (`runCodexAgentic`, subscription not API).

---

## Context the engineer needs (read before starting)

- **Master spec:** `docs/superpowers/specs/2026-06-27-research-grade-pipeline-redesign-design.md` — see the "Per-stage producers + critic criteria" section (the authoritative source for the criteria text) and "Backtracking, budgets, termination".
- **Phase 1 is built** on this branch (`feat/research-grade-pipeline-redesign`). The producer→critic state machine, the pure router (`src/lib/research/router.ts`), the critic job plumbing, `CriticVerdictSchema` + `parseCriticVerdict`, the worker's `runStageCriticJob`, and the claim route's `buildStageCriticJobInput` already exist and are green. Phase 2 only makes the critic's *content* real.
- **Pipeline order in this phase is still `plan → literature → experiment → analysis`** (`EXECUTABLE_STAGES` in `src/lib/research/stages.ts`). The `literature → plan` reorder is Phase 3. **Write the criteria for the current order** — e.g. the `plan` critic runs FIRST and therefore cannot check "grounded in the literature" (literature doesn't exist yet); that criterion moves to the plan critic in Phase 3 when the reorder lands.
- **Critics are agentic Codex runs with web access.** Criteria may instruct the critic to verify citations/claims via web search. The critic sees: the artifact under judgment (`ARTIFACT.json`), the source paper (`SOURCE.json`), the live upstream artifacts (`UPSTREAM_<stage>.json`), and the criteria text. Deep inspection of the producer's raw workspace files (e.g. opening the experiment's CSVs) is **out of scope for Phase 2** — the experiment critic detects toy data from the artifact's self-reported paths/sizes/provenance + the plan's required scale.

### Environment / commands (Windows + this repo)

- Use `npx` directly (the worker + tests are Node/tsx, not Python).
- `npx prisma generate` is not needed in Phase 2 (no schema change), but run it if the client looks stale.
- **Postgres-backed tests** (`research-worker-routes`, `research-lifecycle`) need the port-swapped env and long timeouts. From bash:
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run <files> --testTimeout=120000 --hookTimeout=120000
  ```
- **Do NOT run the full suite** (it hangs). Run only the files named in each task. When running multiple Postgres files, run them **serially / one file at a time** (parallel runs race on `CREATE DATABASE`).
- `npx tsc --noEmit` after each task.
- This phase has **no DB migration**.

---

## Cross-task name contract (use these exact names everywhere)

- New file `src/lib/research/critic-criteria.ts` exports:
  - `type StageCriteria = { criteria: string[]; routingGuidance: string }`
  - `const CRITIC_CRITERIA: Record<ExecutableStage, StageCriteria>`
  - `function renderCriticCriteria(stage: ExecutableStage): string`
- `src/lib/research/stages.ts` gains `function stagesBefore(stage: ResearchStage): ExecutableStage[]` (mirror of the existing `stagesAfter`).
- `src/lib/v2/schemas.ts` `CriticVerdictSchema` gains a `superRefine` rule: on `BACKTRACK`, `targetStage` must be strictly **before** `stageType` in `RESEARCH_STAGES` order.
- The critic job input shape (server builds it, worker parses it) gains:
  - `upstreamArtifacts: { stageType: string; artifact: unknown }[]`
- `src/app/api/workers/claim/route.ts` `buildStageCriticJobInput` returns `criteria: renderCriticCriteria(stage)` (not the placeholder) and `upstreamArtifacts` gathered from `stagesBefore(stage)` via the existing `findLiveArtifact`.
- `scripts/researchfinder-worker.ts`: `StageCriticJobInput` gains `upstreamArtifacts`; `parseStageCriticJobInput` reads it (defaulting to `[]`); `runStageCriticJob` writes each as `UPSTREAM_<stageType>.json`; `buildStageCriticPrompt` lists the upstream files and keeps the literal strings `"CriticVerdict"` and `"PASS|REDO|BACKTRACK"` (pinned by an existing test).

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/research/critic-criteria.ts` (new) | Per-stage criteria + routing guidance + `renderCriticCriteria` | 1 |
| `tests/critic-criteria.test.ts` (new) | Unit tests for the registry + renderer | 1 |
| `src/lib/v2/schemas.ts` (modify) | `CriticVerdictSchema` upstream-only BACKTRACK rule | 2 |
| `tests/critic-verdict-schema.test.ts` (modify) | Tests for the new rule | 2 |
| `src/lib/research/stages.ts` (modify) | `stagesBefore` helper | 3 |
| `tests/research-stages.test.ts` (modify) | `stagesBefore` unit test | 3 |
| `src/app/api/workers/claim/route.ts` (modify) | Real criteria + upstream artifacts in critic input | 3 |
| `tests/research-worker-routes.test.ts` (modify) | Postgres route tests for the new critic input | 3 |
| `scripts/researchfinder-worker.ts` (modify) | Parse + write upstream artifacts; enriched prompt | 4 |
| `tests/researchfinder-worker.test.ts` (modify) | Worker test for upstream artifacts in the prompt | 4 |

---

## Task 1: per-stage critic criteria registry + renderer

**Files:**
- Create: `src/lib/research/critic-criteria.ts`
- Create: `tests/critic-criteria.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/critic-criteria.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { CRITIC_CRITERIA, renderCriticCriteria } from "@/lib/research/critic-criteria";
import { EXECUTABLE_STAGES } from "@/lib/research/stages";

describe("CRITIC_CRITERIA registry", () => {
  it("defines criteria + routing guidance for every executable stage", () => {
    for (const stage of EXECUTABLE_STAGES) {
      const entry = CRITIC_CRITERIA[stage];
      expect(entry.criteria.length).toBeGreaterThanOrEqual(3);
      expect(entry.criteria.every((c) => c.trim().length > 0)).toBe(true);
      expect(entry.routingGuidance.trim().length).toBeGreaterThan(0);
    }
  });

  it("encodes the experiment toy-data gate and a backtrack-to-plan route", () => {
    const exp = CRITIC_CRITERIA.experiment;
    const text = [exp.criteria.join(" "), exp.routingGuidance].join(" ").toLowerCase();
    expect(text).toContain("real");
    expect(text).toContain("toy");
    expect(exp.routingGuidance.toLowerCase()).toContain("backtrack to plan");
  });

  it("routes analysis backtracks to the experiment stage", () => {
    expect(CRITIC_CRITERIA.analysis.routingGuidance.toLowerCase()).toContain("backtrack to experiment");
  });

  it("makes the plan critic REDO-only (no upstream stage to backtrack to in the current order)", () => {
    expect(CRITIC_CRITERIA.plan.routingGuidance.toLowerCase()).toContain("redo");
    expect(CRITIC_CRITERIA.plan.routingGuidance.toLowerCase()).not.toContain("backtrack to");
  });
});

describe("renderCriticCriteria", () => {
  it("renders a numbered checklist + routing guidance + a per-criterion scorecard instruction", () => {
    const rendered = renderCriticCriteria("experiment");
    for (const c of CRITIC_CRITERIA.experiment.criteria) {
      expect(rendered).toContain(c);
    }
    expect(rendered).toContain(CRITIC_CRITERIA.experiment.routingGuidance);
    expect(rendered).toContain("1.");
    expect(rendered.toLowerCase()).toContain("one scorecard entry per criterion");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/critic-criteria.test.ts`
Expected: FAIL — `Cannot find module '@/lib/research/critic-criteria'`.

- [ ] **Step 3: Create the registry + renderer**

Create `src/lib/research/critic-criteria.ts`:

```ts
import { type ExecutableStage } from "@/lib/research/stages";

export type StageCriteria = {
  criteria: string[];
  routingGuidance: string;
};

// Per-stage critic criteria. Authoritative source: the master design spec's
// "Per-stage producers + critic criteria" section. Written for the CURRENT pipeline
// order (plan -> literature -> experiment -> analysis); the literature<->plan reorder
// in Phase 3 will revisit the plan/literature criteria.
export const CRITIC_CRITERIA: Record<ExecutableStage, StageCriteria> = {
  plan: {
    criteria: [
      "Feasibility: every step is genuinely executable here — a Codex agent with web access + local CPU/GPU + PUBLIC data/code. No step requires paid LLM API keys, proprietary data, or hardware we do not have.",
      "Named, real, available datasets/benchmarks: each dataset or benchmark is named and publicly obtainable (a resolvable URL or a well-known public source), not a placeholder or a to-be-fabricated toy.",
      "Rigor: the design specifies baselines, multiple seeds/repetitions, ablations, and a concrete statistical-analysis plan — not a single one-shot run.",
      "Measurable success criteria: quantitative, decidable pass/fail thresholds tied to the stated metrics.",
      "Grounded in the source paper: the plan states a concrete novel contribution relative to the source paper and cites it."
    ],
    routingGuidance:
      "This is the first stage, so there is no upstream stage to return to — every deficiency is a REDO. REDO if the study is infeasible as described, vague, under-powered (missing ablations/seeds/statistics), uses toy or unavailable data, or lacks measurable success criteria."
  },
  literature: {
    criteria: [
      "Real, URL-verifiable sources: related works cite resolvable URLs/DOIs to real papers. Spot-check them with web search; hallucinated or unresolvable citations are disqualifying.",
      "Concrete, real gap: the identified gap is specific and genuinely open, not a vague truism.",
      "Usable resources surfaced: the review inventories publicly available datasets/code/benchmarks relevant to this direction (this feeds experiment feasibility).",
      "Grounded in the source paper: the review positions the work relative to the source paper and cites it."
    ],
    routingGuidance:
      "REDO if citations are hallucinated or unverifiable, the gap is vague, or no usable public resources are surfaced. BACKTRACK to plan only if the survey shows the planned study is fundamentally misframed (root cause is the plan, not the survey)."
  },
  experiment: {
    criteria: [
      "Real data with real provenance: data was obtained from real public sources with traceable provenance (download/build steps and source URLs). Self-reported artifact paths and sizes must look real — a few-hundred-byte fixture, or a name containing '_style_micro', '_toy', '_synthetic', or 'dummy', signals a fabricated stand-in.",
      "Scale and coverage match the plan: all planned conditions, datasets, baselines, and seeds/repetitions were actually run — not a reduced 'smallest credible' subset. Compare against UPSTREAM_plan.json.",
      "Real metrics vs baselines: reported metrics are computed from the runs against the planned baselines, with raw outputs/artifacts saved.",
      "Grounded in the source paper: results are framed against the source paper and cite it."
    ],
    routingGuidance:
      "If the data is fabricated/toy/synthetic, or the study is infeasible as planned, BACKTRACK to plan to re-scope (the root cause is upstream). If the work is real but thin or incomplete (a missing seed or condition), REDO."
  },
  analysis: {
    criteria: [
      "Appropriate, correct statistics: significance tests, effect sizes, confidence intervals, and multiple-comparison corrections appropriate to the design — not just raw means.",
      "Claims supported by the data: every stated finding is backed by the experiment's actual results — cross-check against UPSTREAM_experiment.json. No claim exceeds what the data shows.",
      "Publication-quality figures/tables: reported artifacts are real (sensible sizes/paths) and referenced, with an honest assessment of each success criterion from UPSTREAM_plan.json.",
      "Honest threats + comparison: limitations and comparison to baselines and the literature are stated honestly."
    ],
    routingGuidance:
      "If the data cannot support the claims because the experiment is insufficient, BACKTRACK to experiment. If the statistics, figures, or writing are flawed but the underlying data is adequate, REDO."
  }
};

// Render a stage's criteria into the prompt block the critic receives as `criteria`.
export function renderCriticCriteria(stage: ExecutableStage): string {
  const { criteria, routingGuidance } = CRITIC_CRITERIA[stage];
  const checklist = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return [
    `Evaluate the ${stage} artifact against ALL of the following criteria.`,
    "Return exactly one scorecard entry per criterion (echo the criterion text in `criterion`),",
    "with pass=true only if the criterion is clearly met. You have web access — use it to verify",
    "any external claim or citation. Default to pass=false when genuinely unsure (anti-rubber-stamp).",
    "",
    "Criteria:",
    checklist,
    "",
    "Routing guidance:",
    routingGuidance
  ].join("\n");
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/critic-criteria.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/research/critic-criteria.ts tests/critic-criteria.test.ts
git commit -m "feat: per-stage critic criteria registry + renderer (Phase 2)"
```

---

## Task 2: harden `CriticVerdictSchema` — BACKTRACK must target an upstream stage

A critic now actually chooses `targetStage`. A BACKTRACK that targets the critic's own stage or a downstream stage is nonsensical (the router would "backtrack forward"). Enforce strictly-upstream targets in the schema, which the completion path (`completeCriticJob` → `CriticVerdictSchema.parse`) already runs.

**Files:**
- Modify: `src/lib/v2/schemas.ts` (the `CriticVerdictSchema` `superRefine`)
- Modify: `tests/critic-verdict-schema.test.ts`

- [ ] **Step 1a: Fix the existing same-stage BACKTRACK test (it will become invalid under the new rule)**

The existing test `"requires both targetStage and feedback when the verdict is BACKTRACK"` asserts that `{ ...base, verdict: "BACKTRACK", targetStage: "plan", feedback: "Re-scope." }` is VALID — but `base.stageType` is `"plan"`, so that is a plan→plan (same-stage) backtrack, which the new rule rejects. Update its positive assertion to a real upstream backtrack. Replace:

```ts
    expect(
      CriticVerdictSchema.safeParse({ ...base, verdict: "BACKTRACK", targetStage: "plan", feedback: "Re-scope." }).success
    ).toBe(true);
```

with:

```ts
    expect(
      CriticVerdictSchema.safeParse({ ...base, stageType: "experiment", verdict: "BACKTRACK", targetStage: "plan", feedback: "Re-scope." }).success
    ).toBe(true);
```

(The negative assertion in that same test — BACKTRACK without `targetStage` → false — is unchanged.)

- [ ] **Step 1b: Add the failing tests**

Append these inside the `describe("CriticVerdictSchema", …)` block in `tests/critic-verdict-schema.test.ts` (before the closing `});` of that describe, after the existing `"rejects targetStage on a non-BACKTRACK verdict"` test):

```ts
  it("accepts a BACKTRACK that targets a strictly-upstream stage", () => {
    expect(
      CriticVerdictSchema.safeParse({
        ...base,
        stageType: "experiment",
        verdict: "BACKTRACK",
        targetStage: "plan",
        feedback: "Toy data; re-scope."
      }).success
    ).toBe(true);
  });

  it("rejects a BACKTRACK that targets the same stage", () => {
    expect(
      CriticVerdictSchema.safeParse({
        ...base,
        stageType: "experiment",
        verdict: "BACKTRACK",
        targetStage: "experiment",
        feedback: "No."
      }).success
    ).toBe(false);
  });

  it("rejects a BACKTRACK that targets a downstream stage", () => {
    expect(
      CriticVerdictSchema.safeParse({
        ...base,
        stageType: "plan",
        verdict: "BACKTRACK",
        targetStage: "experiment",
        feedback: "No."
      }).success
    ).toBe(false);
  });
```

- [ ] **Step 2: Run them and watch the two rejection tests fail**

Run: `npx vitest run tests/critic-verdict-schema.test.ts`
Expected: FAIL — "rejects a BACKTRACK that targets the same stage" and "…downstream stage" currently pass validation (success === true) because no ordering rule exists yet.

- [ ] **Step 3: Add the ordering rule to the schema**

In `src/lib/v2/schemas.ts`, the current `CriticVerdictSchema` `superRefine` enforces that BACKTRACK requires `targetStage` and that non-BACKTRACK forbids it. Extend the `if (value.verdict === "BACKTRACK") { … }` branch so that, when `targetStage` IS present, it must be strictly upstream. Replace the existing BACKTRACK branch body:

```ts
  if (value.verdict === "BACKTRACK") {
    if (!value.targetStage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "BACKTRACK verdict requires targetStage",
        path: ["targetStage"]
      });
    }
  } else if (value.targetStage !== undefined) {
```

with:

```ts
  if (value.verdict === "BACKTRACK") {
    if (!value.targetStage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "BACKTRACK verdict requires targetStage",
        path: ["targetStage"]
      });
    } else {
      const stageIndex = RESEARCH_STAGES.indexOf(value.stageType);
      const targetIndex = RESEARCH_STAGES.indexOf(value.targetStage);
      if (targetIndex >= stageIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "BACKTRACK targetStage must be a stage strictly before stageType",
          path: ["targetStage"]
        });
      }
    }
  } else if (value.targetStage !== undefined) {
```

Note: `RESEARCH_STAGES` is already imported in `schemas.ts` (it backs `z.enum(RESEARCH_STAGES)` used by this schema). If a lint/tsc error says it is not imported, add `import { RESEARCH_STAGES } from "@/lib/research/stages";` — but verify first; it should already be there.

- [ ] **Step 4: Run the full critic-verdict file and watch it pass**

Run: `npx vitest run tests/critic-verdict-schema.test.ts`
Expected: PASS (all existing tests + the 3 new ones).

- [ ] **Step 5: Confirm the router/lifecycle tests still pass (the schema flows through completion)**

Run: `npx vitest run tests/research-router.test.ts`
Expected: PASS (10 tests — the router is unaffected; this is a guard against accidental coupling).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/v2/schemas.ts tests/critic-verdict-schema.test.ts
git commit -m "feat: CriticVerdictSchema enforces strictly-upstream BACKTRACK targets (Phase 2)"
```

---

## Task 3: claim route ships real criteria + live upstream artifacts

**Files:**
- Modify: `src/lib/research/stages.ts` (add `stagesBefore`)
- Modify: `tests/research-stages.test.ts` (unit test for `stagesBefore`)
- Modify: `src/app/api/workers/claim/route.ts` (`buildStageCriticJobInput`)
- Modify: `tests/research-worker-routes.test.ts` (Postgres route tests)

- [ ] **Step 1: Write the failing `stagesBefore` unit test**

Open `tests/research-stages.test.ts`, read it to match its import + assertion style, then add a test. It imports from `@/lib/research/stages`. Add:

```ts
  it("stagesBefore returns the executable stages strictly before, in order", () => {
    expect(stagesBefore("plan")).toEqual([]);
    expect(stagesBefore("literature")).toEqual(["plan"]);
    expect(stagesBefore("experiment")).toEqual(["plan", "literature"]);
    expect(stagesBefore("analysis")).toEqual(["plan", "literature", "experiment"]);
  });
```

Add `stagesBefore` to the existing import from `@/lib/research/stages` at the top of that test file.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/research-stages.test.ts`
Expected: FAIL — `stagesBefore is not a function` / not exported.

- [ ] **Step 3: Add `stagesBefore` to `stages.ts`**

In `src/lib/research/stages.ts`, directly after the existing `stagesAfter` function, add:

```ts
// Executable stages strictly before `stage`, in pipeline order. Used to attach the
// upstream artifacts a critic needs to evaluate cross-stage criteria.
export function stagesBefore(stage: ResearchStage): ExecutableStage[] {
  const endIndex = RESEARCH_STAGES.indexOf(stage);
  const before: ExecutableStage[] = [];
  for (let i = 0; i < endIndex; i++) {
    const prior = RESEARCH_STAGES[i];
    if ((EXECUTABLE_STAGES as readonly ResearchStage[]).includes(prior)) {
      before.push(prior as ExecutableStage);
    }
  }
  return before;
}
```

- [ ] **Step 4: Run the stages test and watch it pass**

Run: `npx vitest run tests/research-stages.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing Postgres route tests**

Open `tests/research-worker-routes.test.ts`. Read the existing `describe("research critic worker routes", …)` block (around line 578) and the seeder it uses (`seedProjectWithPlanCriticJob`) to match the harness style. You will (a) strengthen the existing plan-critic test to assert real criteria + empty upstream, and (b) add a new test that seeds an **experiment** critic with live plan + literature artifacts and asserts the upstream artifacts come through.

First, in the existing plan-critic test (`"claims a plan critic job and returns a critic input with the artifact to judge"`), the last assertion is currently `expect(payload.job.input.criteria).toContain("Phase 2");`. Replace that single line with:

```ts
      expect(payload.job.input.criteria).toContain("Feasibility");
      expect(payload.job.input.criteria.toLowerCase()).toContain("one scorecard entry per criterion");
```

(That test's `payload.job.input` type literal doesn't declare `upstreamArtifacts`; you don't need to assert it there — the new test below covers upstream.)

Then add a new seeder next to `seedProjectWithPlanCriticJob` (model it exactly on that one — same user/worker/paper/idea creation, but at the `experiment` stage with live `plan` + `literature` + `experiment` artifacts and a queued **experiment** critic job; use DISTINCT unique values to avoid any collision):

```ts
async function seedProjectWithExperimentCriticJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "worker-routes-exp-critic@example.com" } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w-exp-critic", tokenHash: "h-exp-critic", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: "2502.00007", title: "Exp Critic Src", abstract: "E",
      url: "https://arxiv.org/abs/2502.00007", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id, paperId: paper.id, inboxDate: "2026-06-25", title: "Exp Critic Idea", summary: "S",
      expandedExplanation: "E", trajectory: "Tr", recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8, feasibilityScore: 0.8,
      overallScore: 0.8, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "experiment" }
  });
  for (const [stageType, marker] of [
    ["plan", "PLAN-ARTIFACT"],
    ["literature", "LIT-ARTIFACT"],
    ["experiment", "EXP-ARTIFACT"]
  ] as const) {
    await client.researchStageArtifact.create({
      data: {
        researchProjectId: project.id,
        stageType,
        artifactJson: JSON.stringify({ researchProjectId: project.id, marker })
      }
    });
  }
  const job = await client.researchStageJob.create({
    data: {
      researchProjectId: project.id, userId: user.id, stageType: "experiment", kind: "critic",
      status: "queued", inputJson: JSON.stringify({ researchProjectId: project.id, stageType: "experiment" })
    }
  });
  return { user, worker, paper, project, job };
}
```

> The artifact `marker` fields are how the test proves the right upstream artifact came through. `buildStageCriticJobInput` only `JSON.parse`s the artifact JSON and passes it through (no shape validation), so the minimal `{ researchProjectId, marker }` artifacts are fine.

Add the test inside the existing `describe("research critic worker routes", …)` block (after the existing plan-critic test):

```ts
  it("attaches live upstream artifacts (plan + literature) and real criteria to an experiment critic", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker, job } = await seedProjectWithExperimentCriticJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };

      const response = await POST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST", headers: { authorization: "Bearer t" }
        })
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        job: {
          id: string;
          type: string;
          input: {
            criteria: string;
            upstreamArtifacts: { stageType: string; artifact: { marker: string } }[];
          };
        };
      };
      expect(payload.job.id).toBe(job.id);
      expect(payload.job.type).toBe("research_experiment_critic");
      expect(payload.job.input.criteria.toLowerCase()).toContain("real data");
      expect(payload.job.input.upstreamArtifacts.map((u) => u.stageType)).toEqual(["plan", "literature"]);
      expect(
        payload.job.input.upstreamArtifacts.find((u) => u.stageType === "plan")?.artifact.marker
      ).toBe("PLAN-ARTIFACT");
    });
  });
```

- [ ] **Step 6: Run the route tests and watch the new ones fail**

Run:
```bash
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: FAIL — the plan-critic test now expects `"Feasibility"` (still gets the placeholder) and `upstreamArtifacts` is `undefined`; the new experiment test fails for the same reasons.

- [ ] **Step 7: Update `buildStageCriticJobInput` in the claim route**

In `src/app/api/workers/claim/route.ts`:

1. Extend the imports. The file imports stage helpers indirectly; add:
```ts
import { renderCriticCriteria } from "@/lib/research/critic-criteria";
import { stagesBefore, type ExecutableStage } from "@/lib/research/stages";
```
(If `stages` is not yet imported in this file, add the import; if it is, merge `stagesBefore`/`ExecutableStage` into the existing import.)

2. Replace the current `buildStageCriticJobInput` body. The current version builds `{ researchProjectId, stageType, artifactToJudge, sourcePaper, criteria }` with a placeholder `criteria`. Replace it with:

```ts
function buildStageCriticJobInput(job: ClaimedResearchStageJob) {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;
  const stage = job.stageType;

  const liveArtifact = findLiveArtifact(job, stage);
  if (!liveArtifact) {
    throw new Error(`Critic stage requires a live ${stage} artifact to judge`);
  }

  const upstreamArtifacts = stagesBefore(stage as ExecutableStage)
    .map((upstreamStage) => {
      const artifact = findLiveArtifact(job, upstreamStage);
      if (!artifact) return null;
      return { stageType: upstreamStage, artifact: JSON.parse(artifact.artifactJson) as unknown };
    })
    .filter((entry): entry is { stageType: ExecutableStage; artifact: unknown } => entry !== null);

  return {
    researchProjectId: job.researchProjectId,
    stageType: stage,
    artifactToJudge: JSON.parse(liveArtifact.artifactJson) as unknown,
    upstreamArtifacts,
    sourcePaper: {
      id: paper.id,
      arxivId: paper.arxivId,
      title: paper.title,
      abstract: paper.abstract,
      url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    criteria: renderCriticCriteria(stage as ExecutableStage)
  };
}
```

> `findLiveArtifact(job, stage)` and `parseJsonArray` already exist in this file (Phase 1). `job.stageType` for a claimed critic job is always an executable stage, so the `as ExecutableStage` casts are safe.

- [ ] **Step 8: Run the route tests and watch them pass**

Run:
```bash
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: PASS (all prior tests + the new experiment-critic test; the plan-critic test now sees real criteria + `[]` upstream).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/research/stages.ts tests/research-stages.test.ts src/app/api/workers/claim/route.ts tests/research-worker-routes.test.ts
git commit -m "feat: critic input ships real per-stage criteria + live upstream artifacts (Phase 2)"
```

---

## Task 4: worker writes upstream artifacts + references them in the critic prompt

**Files:**
- Modify: `scripts/researchfinder-worker.ts` (`StageCriticJobInput`, `parseStageCriticJobInput`, `runStageCriticJob`, `buildStageCriticPrompt`)
- Modify: `tests/researchfinder-worker.test.ts`

- [ ] **Step 1: Write the failing worker test**

Open `tests/researchfinder-worker.test.ts` and read the existing critic test (around line 924, `"completes a claimed research critic job with an agentic stub run and validated verdict"`). Add a new test directly after it that supplies `upstreamArtifacts` in the claimed job's `input` and asserts the prompt references the upstream file names:

```ts
  it("writes upstream artifacts and references them in the critic prompt", async () => {
    const verdictOutput = {
      researchProjectId: "proj-1",
      stageType: "experiment",
      verdict: "PASS",
      scorecard: [{ criterion: "Real data", pass: true, note: "Provenance traceable." }]
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_experiment_critic",
            id: "exp-critic-1",
            input: {
              researchProjectId: "proj-1",
              stageType: "experiment",
              artifactToJudge: { researchProjectId: "proj-1", findings: ["f1"] },
              upstreamArtifacts: [
                { stageType: "plan", artifact: { researchProjectId: "proj-1", marker: "PLAN" } },
                { stageType: "literature", artifact: { researchProjectId: "proj-1", marker: "LIT" } }
              ],
              sourcePaper: {
                id: "p1", arxivId: "2401.00001", title: "Source Paper", abstract: "A.",
                url: "https://arxiv.org/abs/2401.00001", authors: [], categories: [],
                publishedAt: "2024-01-01T00:00:00.000Z"
              },
              criteria: "Evaluate the experiment artifact. 1. Real data with real provenance."
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodexAgentic = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify(verdictOutput);
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      { appUrl: "https://research.example.com", workerToken: "worker-token", codexCommand: "codex-test" },
      { runCodexAgentic, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(promptText).toContain("UPSTREAM_plan.json");
    expect(promptText).toContain("UPSTREAM_literature.json");
    expect(promptText).toContain("Real data with real provenance");
    // The existing JSON-shape contract must still hold:
    expect(promptText).toContain("CriticVerdict");
    expect(promptText).toContain("PASS|REDO|BACKTRACK");
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: FAIL — the prompt does not yet mention `UPSTREAM_plan.json` (the worker ignores `upstreamArtifacts`).

- [ ] **Step 3: Extend the input type + parser**

In `scripts/researchfinder-worker.ts`, update the `StageCriticJobInput` type (currently `{ researchProjectId; stageType; artifactToJudge; sourcePaper; criteria }`) to add the upstream field:

```ts
type StageCriticJobInput = {
  researchProjectId: string;
  stageType: string;
  artifactToJudge: unknown;
  upstreamArtifacts: { stageType: string; artifact: unknown }[];
  sourcePaper: unknown;
  criteria: string;
};
```

Update `parseStageCriticJobInput` to read it tolerantly (default `[]`, skip malformed entries):

```ts
function parseStageCriticJobInput(value: unknown): StageCriticJobInput {
  if (!isRecord(value)) {
    throw new FatalWorkerError("Stage critic job input must be an object");
  }
  const rawUpstream = Array.isArray(value.upstreamArtifacts) ? value.upstreamArtifacts : [];
  const upstreamArtifacts = rawUpstream
    .filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.stageType === "string")
    .map((entry) => ({ stageType: entry.stageType as string, artifact: entry.artifact }));
  return {
    researchProjectId: readString(value.researchProjectId, "researchProjectId"),
    stageType: readString(value.stageType, "stageType"),
    artifactToJudge: value.artifactToJudge,
    upstreamArtifacts,
    sourcePaper: value.sourcePaper,
    criteria: readString(value.criteria, "criteria")
  };
}
```

- [ ] **Step 4: Write the upstream files in `runStageCriticJob`**

In `runStageCriticJob`, right after the two existing `writeFile` calls for `ARTIFACT.json` and `SOURCE.json`, add a loop that writes each upstream artifact:

```ts
  await writeFile(join(workspaceDir, "ARTIFACT.json"), JSON.stringify(input.artifactToJudge, null, 2), "utf8");
  await writeFile(join(workspaceDir, "SOURCE.json"), JSON.stringify(input.sourcePaper, null, 2), "utf8");
  for (const upstream of input.upstreamArtifacts) {
    await writeFile(
      join(workspaceDir, `UPSTREAM_${upstream.stageType}.json`),
      JSON.stringify(upstream.artifact, null, 2),
      "utf8"
    );
  }
```

- [ ] **Step 5: Reference the upstream files in `buildStageCriticPrompt`**

Replace the final lines of `buildStageCriticPrompt`. The current builder ends with the criteria block + a line pointing at `ARTIFACT.json` and `SOURCE.json`. Update it to also list the upstream files when present. Replace the whole function with:

```ts
function buildStageCriticPrompt(input: StageCriticJobInput) {
  const upstreamFiles = input.upstreamArtifacts.map((u) => `UPSTREAM_${u.stageType}.json`);
  const upstreamLine =
    upstreamFiles.length > 0
      ? `Upstream stage artifacts for cross-checking are in: ${upstreamFiles.join(", ")}.`
      : "There are no upstream stage artifacts for this stage.";
  return [
    "You are an adversarial research critic. Judge the ARTIFACT.json in your current working",
    "directory against the stated criteria and return a single CriticVerdict JSON as your final message.",
    "Do not wrap it in Markdown. Default to rejection when genuinely unsure (anti-rubber-stamp).",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    `The JSON stageType must be exactly ${JSON.stringify(input.stageType)}.`,
    "Required keys: researchProjectId, stageType, verdict (one of PASS|REDO|BACKTRACK),",
    "scorecard (>=1, each {criterion, pass: boolean, note}).",
    "If verdict is REDO or BACKTRACK, include feedback. If verdict is BACKTRACK, also include",
    "targetStage — it must be a stage STRICTLY BEFORE this one (one of plan|literature|experiment|analysis).",
    "Criteria for this stage:",
    input.criteria,
    "",
    "The artifact to judge and the source paper are in ARTIFACT.json and SOURCE.json in this directory.",
    upstreamLine
  ].join("\n");
}
```

> This keeps the literal strings `"CriticVerdict"` and `"PASS|REDO|BACKTRACK"` (pinned by the existing critic test) and tightens the `targetStage` instruction to match the Task 2 schema rule.

- [ ] **Step 6: Run the worker tests and watch them pass**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: PASS (all prior worker tests including the original critic test + the new upstream test).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add scripts/researchfinder-worker.ts tests/researchfinder-worker.test.ts
git commit -m "feat: critic worker writes upstream artifacts + references them in the prompt (Phase 2)"
```

---

## Task 5: final verification

No code. Verify the whole phase is green and typechecks.

- [ ] **Step 1: Run the fast branch-relevant unit suites**

Run:
```bash
npx vitest run tests/critic-criteria.test.ts tests/critic-verdict-schema.test.ts tests/research-stages.test.ts tests/research-router.test.ts tests/researchfinder-worker.test.ts tests/research-schemas.test.ts tests/worker-output-validation.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Run the Postgres-backed suites (serially)**

Run each on its own to avoid the `CREATE DATABASE` race:
```bash
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/')
npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
npx vitest run tests/research-lifecycle.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: all PASS (lifecycle is unchanged by Phase 2 but proves the schema change didn't regress completion routing).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

---

## Spec coverage (self-review)

| Master-spec Phase 2 requirement | Task |
|---|---|
| Per-stage critic criteria (literature/plan/experiment/analysis) | 1 (registry, current-order-adjusted) |
| Verdict schemas wired into the loop | 2 (upstream-BACKTRACK hardening) + already-existing `CriticVerdictSchema` (Phase 1) |
| Experiment critic "key gate" — real-vs-toy data | 1 (explicit toy-data criterion) + 3 (plan artifact attached for scale comparison) |
| Analysis critic — claims supported / BACKTRACK to experiment | 1 (criterion + routing) + 3 (experiment artifact attached) |
| Critic chooses REDO vs BACKTRACK by root cause | 1 (routingGuidance) + 2 (upstream-only target) |
| Criteria delivered to the agentic critic | 3 (claim route) + 4 (worker prompt) |

**Out of scope for Phase 2 (deferred, by design):**
- Producer prompts acting on the stored REDO `feedback` (so a REDO changes producer behavior) → **Phase 3** (producer overhaul), where prompts are rewritten anyway. Until then a REDO relies on Codex non-determinism.
- The `literature → plan` reorder → **Phase 3**; the plan/literature criteria here are written for the current order and will be revisited then.
- Critics opening the producer's raw workspace files (e.g. reading the experiment's CSVs) → later refinement; Phase 2 critics judge the artifact JSON + upstream artifact JSONs + web verification.
- The loop observability dashboard → **Phase 5**.

## Traceability — exact names introduced (guard against drift)

- `src/lib/research/critic-criteria.ts`: `StageCriteria`, `CRITIC_CRITERIA`, `renderCriticCriteria`
- `src/lib/research/stages.ts`: `stagesBefore`
- `src/lib/v2/schemas.ts`: `CriticVerdictSchema` superRefine — "BACKTRACK targetStage must be a stage strictly before stageType"
- critic job input field: `upstreamArtifacts: { stageType: string; artifact: unknown }[]`
- workspace files: `UPSTREAM_<stageType>.json`
