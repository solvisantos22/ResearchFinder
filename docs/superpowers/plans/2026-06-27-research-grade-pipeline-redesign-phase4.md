# Research-Grade Pipeline Redesign — Phase 4 (Paper Stage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the final `paper` stage — an agentic producer that assembles all upstream artifacts into a complete academic paper, writes LaTeX, and compiles it to a PDF locally; plus the strictest critic gate; advancing a passing project to a new terminal status `paper_ready`.

**Architecture:** `paper` becomes the last executable stage (after `analysis`). The producer runs like the analysis producer — an agentic Codex run `--cd` the project workspace root so it can read the `analysis/` figures and `experiment/` outputs — and writes `paper/main.tex` + compiles `paper/main.pdf` (via `tectonic` or `pdflatex`). It self-reports a `PaperResult` (title/abstract/novelty/section list/tex+pdf paths/artifacts/citations). The Phase-1 state machine and Phase-2 generic critic plumbing already handle any executable stage, so `paper` flows through them automatically once registered; the only behavioral change is the terminal status flips from `analysis_ready` to `paper_ready` (analysis PASS now enqueues the paper producer).

**Tech Stack:** TypeScript, Next.js App Router, Zod (`strictObject`, `CoercibleString`), Prisma/Postgres, Vitest (+ Postgres-backed tests), the tsx worker (`scripts/researchfinder-worker.ts`), Codex CLI (`runCodexAgentic`), and a local LaTeX toolchain (`tectonic`/`pdflatex`) on the worker machine.

---

## Context the engineer needs (read before starting)

- **Master spec:** `docs/superpowers/specs/2026-06-27-research-grade-pipeline-redesign-design.md` — the `paper` producer + critic descriptions (the "strictest gate"), the `paper_ready` terminal, and the local-artifacts decision (`.tex` + `.pdf` + figures live locally, referenced by path; the dashboard shows metadata + paths + verdict).
- **Phases 1–3 are built** on branch `feat/research-grade-pipeline-redesign`. The producer→critic state machine (`src/lib/jobs/research.ts`), the pure router (`src/lib/research/router.ts`), the per-stage critic criteria (`src/lib/research/critic-criteria.ts`), the generic critic claim input (`buildStageCriticJobInput`) + worker `runStageCriticJob`, and the feedback-injection helper (`buildPriorFeedbackSection`) all exist and are green. **They already handle any executable stage generically** — once `paper` is registered, the critic side needs only a criteria entry + the lane/whitelist additions.
- **Real external dependency:** the paper producer compiles LaTeX → PDF locally. It needs `tectonic` (preferred — single binary, auto-fetches packages) or `pdflatex` installed on the worker machine. If neither is present, the producer must report `compiled: false` honestly (the critic will REDO/eventually `needs_review`); it must NOT fabricate a PDF. Do not install LaTeX as part of this plan.
- **Two output-validation points** both need `paper`: the server validates completion via `STAGE_REGISTRY[stage].outputSchema` (`src/lib/research/stages.ts`), and the worker validates before sending via `RESEARCH_STAGE_SCHEMAS` in `src/worker/output-validation.ts`. Register `paper` in BOTH.
- **Terminal change breaks three existing tests** the moment `paper` joins `EXECUTABLE_STAGES` (analysis is no longer last): the router unit test "PASS on analysis (no next stage) terminates analysis_ready", the lifecycle test "analysis completion + critic PASS sets … analysis_ready", and the route test "completes a research_analysis job and sets the project analysis_ready". Task 2 updates ALL THREE in the same commit so the suite never goes red.
- **`paper` is already in both `RESEARCH_STAGES` lists** (`src/lib/v2/domain.ts:60` and `src/lib/research/stages.ts:4`) — do NOT re-add it there. `RESEARCH_PROJECT_STATUSES` does NOT yet contain `paper_ready` — Task 2 adds it.

### Environment / commands

- Use `npx` directly. No Prisma migration in this phase (no DB schema change; `paper_ready` is a String value, not a DB enum).
- Postgres-backed tests need the port-swapped env + long timeouts, one file at a time:
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run <file> --testTimeout=120000 --hookTimeout=120000
  ```
- Fast suites need no DB. `npx tsc --noEmit` after each task. **Do NOT run the full suite** (it hangs).

---

## Cross-task name contract (use these exact names)

- `src/lib/v2/schemas.ts`: `PaperResultSchema`, `PaperJobInputSchema`; types `PaperResult`, `PaperJobInput`.
- `src/worker/output-validation.ts`: add `paper: PaperResultSchema` to `RESEARCH_STAGE_SCHEMAS`.
- `src/lib/v2/domain.ts`: `RESEARCH_PROJECT_STATUSES` gains `"paper_ready"`.
- `src/lib/research/stages.ts`: `EXECUTABLE_STAGES` gains `"paper"`; `STAGE_REGISTRY.paper = { outputSchema: PaperResultSchema, requiresSourcePaperCitation: true }`.
- `src/lib/research/router.ts`: terminal status (when `stagesAfter(stage)` is empty) becomes `"paper_ready"` (was `"analysis_ready"`).
- `src/lib/research/critic-criteria.ts`: `CRITIC_CRITERIA.paper` entry.
- `src/lib/workers/lanes.ts`: `WORKER_JOB_TYPES` + `LANE_JOB_TYPES.research`/`.both` gain `"research_paper"` and `"research_paper_critic"`.
- `src/app/api/workers/jobs/[jobId]/complete/route.ts`: local `WorkerJobType` union, `markWorkerJobFailed` research branch, and `resolveJobType` requestedType whitelist gain `research_paper` + `research_paper_critic`.
- `scripts/researchfinder-worker.ts`: `parseClaimPayload` whitelist gains both; `buildPaperJobInput`→`runPaperJob`→`buildPaperPrompt`; dispatch routes `research_paper`→`runPaperJob` and adds `research_paper_critic` to the existing critic dispatch OR.
- `src/app/api/workers/claim/route.ts`: `buildPaperJobInput` (gathers all upstream artifacts + source paper + feedback) wired into the producer switch.
- Workspace files: `paper/INPUT.json`, `paper/main.tex`, `paper/main.pdf`.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/v2/schemas.ts` + `src/worker/output-validation.ts` (modify) | `PaperResultSchema`/`PaperJobInputSchema` + worker validation | 1 |
| `tests/research-schemas.test.ts` (modify) | paper schema tests | 1 |
| `src/lib/v2/domain.ts` + `src/lib/research/stages.ts` + `src/lib/research/router.ts` (modify) | `paper_ready`; `paper` executable + registry; terminal flip | 2 |
| `tests/domain.test.ts` + `tests/research-stages.test.ts` + `tests/research-router.test.ts` (modify) | status/stage/router unit tests + terminal flip | 2 |
| `tests/research-lifecycle.test.ts` + `tests/research-worker-routes.test.ts` (modify) | terminal-flip integration tests (analysis→paper, paper→paper_ready) | 2 (Step 7) |
| `src/lib/research/critic-criteria.ts` (modify) | `paper` critic criteria | 3 |
| `tests/critic-criteria.test.ts` (modify) | paper criteria test | 3 |
| `src/lib/workers/lanes.ts` + `complete/route.ts` + `scripts/researchfinder-worker.ts` (modify) | lane + 3 whitelists | 4 |
| `tests/worker-lanes.test.ts` (modify) | lane test | 4 |
| `src/app/api/workers/claim/route.ts` (modify) | `buildPaperJobInput` | 5 |
| `tests/research-worker-routes.test.ts` (modify) | paper producer + paper critic claim tests | 5 |
| `scripts/researchfinder-worker.ts` (modify) | `runPaperJob` + `buildPaperPrompt` + dispatch | 6 |
| `tests/researchfinder-worker.test.ts` (modify) | paper worker test | 6 |
| `src/app/research/[projectId]/page.tsx` (modify) | paper section + empty-state | 7 |
| (no files) | final verification — fast + Postgres suites + tsc | 8 |

---

## Task 1: `PaperResultSchema` + `PaperJobInputSchema` + worker validation

**Files:**
- Modify: `src/lib/v2/schemas.ts`
- Modify: `src/worker/output-validation.ts`
- Modify: `tests/research-schemas.test.ts`

- [ ] **Step 1: Write the failing schema tests**

In `tests/research-schemas.test.ts`, add a new describe block at the end:

```ts
import { PaperResultSchema, PaperJobInputSchema } from "@/lib/v2/schemas";

describe("PaperResultSchema", () => {
  const valid = {
    researchProjectId: "proj-1",
    relationToSourcePaper: "Extends the source method to a new benchmark.",
    title: "A Rigorous Study of X",
    abstract: "We study X and find Y.",
    noveltyStatement: "First to evaluate X on the public Z benchmark with ablations.",
    sections: ["Introduction", "Related Work", "Method", "Experiments", "Results", "Conclusion"],
    texPath: "paper/main.tex",
    pdfPath: "paper/main.pdf",
    compiled: true,
    artifacts: [
      { path: "paper/main.pdf", caption: "Compiled paper", kind: "pdf", bytes: 240000 },
      { path: "analysis/fig1.png", caption: "Accuracy vs depth", kind: "figure", bytes: 30000 }
    ],
    summary: "A submittable workshop-grade draft.",
    citations: [
      { sourceType: "paper", title: "Source", url: "https://arxiv.org/abs/2501.00001", sourceId: "2501.00001", claim: "Foundational", confidence: 0.9 }
    ]
  };

  it("accepts a complete paper result", () => {
    expect(PaperResultSchema.parse(valid)).toMatchObject({ researchProjectId: "proj-1", compiled: true });
  });

  it("requires at least one section and one citation", () => {
    expect(PaperResultSchema.safeParse({ ...valid, sections: [] }).success).toBe(false);
    expect(PaperResultSchema.safeParse({ ...valid, citations: [] }).success).toBe(false);
  });

  it("rejects unknown keys and a non-boolean compiled", () => {
    expect(PaperResultSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(PaperResultSchema.safeParse({ ...valid, compiled: "yes" }).success).toBe(false);
  });

  it("coerces object-valued content fields to strings", () => {
    const parsed = PaperResultSchema.parse({ ...valid, abstract: { text: "We study X." } });
    expect(typeof parsed.abstract).toBe("string");
  });
});

describe("PaperJobInputSchema", () => {
  const valid = {
    jobId: "job-1", userId: "user-1", researchProjectId: "proj-1",
    idea: { id: "i1", title: "T", summary: "S", expandedExplanation: "E", trajectory: "Tr", smallestSprint: "SS" },
    paper: {
      id: "p1", arxivId: "2501.00001", title: "Source", abstract: "A", url: "https://arxiv.org/abs/2501.00001",
      authors: ["Ada"], categories: ["cs.LG"], publishedAt: "2026-06-25T00:00:00.000Z"
    },
    plan: { relationToSourcePaper: "Extends.", hypotheses: ["H1"], successCriteria: ["beats baseline"], metrics: ["acc"], baselines: ["ResNet"], experimentalDesign: "ablation" },
    literature: { positioning: "We close the Z gap.", gaps: ["no open benchmark"] },
    experiment: { summary: "Ran full study.", verdict: "success", findings: ["X improves Y"] },
    analysis: { summary: "Supports hypotheses.", verdict: "supports_hypotheses", keyFindings: ["+4% acc"], comparisonToBaselines: "Beats ResNet." },
    citations: [{ sourceType: "paper", title: "Source", url: "https://arxiv.org/abs/2501.00001", sourceId: "2501.00001", claim: "Foundational", confidence: 0.9 }]
  };

  it("accepts a valid paper job input", () => {
    expect(PaperJobInputSchema.parse(valid)).toMatchObject({ jobId: "job-1" });
  });

  it("accepts an optional feedback string", () => {
    expect(PaperJobInputSchema.parse({ ...valid, feedback: "Tighten the abstract." }).feedback).toBe("Tighten the abstract.");
  });

  it("rejects unknown keys", () => {
    expect(PaperJobInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/research-schemas.test.ts`
Expected: FAIL — `PaperResultSchema`/`PaperJobInputSchema` are not exported.

- [ ] **Step 3: Add the schemas**

In `src/lib/v2/schemas.ts`, after `AnalysisJobInputSchema` (it ends around line 540s with `feedback: NonEmptyTrimmedStringSchema.optional()` then `});`), add:

```ts
export const PaperResultSchema = strictObject({
  researchProjectId: NonEmptyTrimmedStringSchema,
  relationToSourcePaper: CoercibleString,
  title: CoercibleString,
  abstract: CoercibleString,
  noveltyStatement: CoercibleString,
  sections: z.array(CoercibleString).min(1),
  texPath: CoercibleString,
  pdfPath: CoercibleString,
  compiled: z.boolean(),
  artifacts: z.array(
    strictObject({
      path: CoercibleString,
      caption: CoercibleString,
      kind: z.enum(["figure", "table", "pdf", "tex"]),
      bytes: z.number().int().nonnegative()
    })
  ),
  summary: CoercibleString,
  citations: z.array(CitationSchema).min(1)
});

export const PaperJobInputSchema = strictObject({
  jobId: NonEmptyTrimmedStringSchema,
  userId: NonEmptyTrimmedStringSchema,
  researchProjectId: NonEmptyTrimmedStringSchema,
  idea: strictObject({
    id: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    summary: NonEmptyTrimmedStringSchema,
    expandedExplanation: NonEmptyTrimmedStringSchema,
    trajectory: NonEmptyTrimmedStringSchema,
    smallestSprint: NonEmptyTrimmedStringSchema
  }),
  paper: strictObject({
    id: NonEmptyTrimmedStringSchema,
    arxivId: NonEmptyTrimmedStringSchema,
    title: NonEmptyTrimmedStringSchema,
    abstract: NonEmptyTrimmedStringSchema,
    url: RequiredUrlSchema,
    authors: z.array(NonEmptyTrimmedStringSchema),
    categories: z.array(NonEmptyTrimmedStringSchema),
    publishedAt: z.string().datetime()
  }),
  plan: strictObject({
    relationToSourcePaper: NonEmptyTrimmedStringSchema,
    hypotheses: z.array(NonEmptyTrimmedStringSchema).min(1),
    successCriteria: z.array(NonEmptyTrimmedStringSchema).min(1),
    metrics: z.array(NonEmptyTrimmedStringSchema),
    baselines: z.array(NonEmptyTrimmedStringSchema),
    experimentalDesign: NonEmptyTrimmedStringSchema
  }),
  literature: strictObject({
    positioning: NonEmptyTrimmedStringSchema,
    gaps: z.array(NonEmptyTrimmedStringSchema).min(1)
  }),
  experiment: strictObject({
    summary: NonEmptyTrimmedStringSchema,
    verdict: NonEmptyTrimmedStringSchema,
    findings: z.array(NonEmptyTrimmedStringSchema).min(1)
  }),
  analysis: strictObject({
    summary: NonEmptyTrimmedStringSchema,
    verdict: NonEmptyTrimmedStringSchema,
    keyFindings: z.array(NonEmptyTrimmedStringSchema).min(1),
    comparisonToBaselines: NonEmptyTrimmedStringSchema
  }),
  citations: z.array(CitationSchema),
  feedback: NonEmptyTrimmedStringSchema.optional()
});
```

Then add the type exports near the other `…JobInput`/result type exports (around line 636-642):

```ts
export type PaperResult = z.infer<typeof PaperResultSchema>;
export type PaperJobInput = z.infer<typeof PaperJobInputSchema>;
```

- [ ] **Step 4: Run the schema tests and watch them pass**

Run: `npx vitest run tests/research-schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Register paper in the worker output validator**

In `src/worker/output-validation.ts`, add `PaperResultSchema` to the import from `@/lib/v2/schemas`, then add `paper` to `RESEARCH_STAGE_SCHEMAS`:

```ts
const RESEARCH_STAGE_SCHEMAS = {
  plan: ResearchPlanSchema,
  literature: LiteratureReviewSchema,
  experiment: ExperimentResultSchema,
  analysis: AnalysisResultSchema,
  paper: PaperResultSchema
} as const;
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).
```bash
git add src/lib/v2/schemas.ts src/worker/output-validation.ts tests/research-schemas.test.ts
git commit -m "feat: PaperResult + PaperJobInput schemas + worker validation (Phase 4)"
```

---

## Task 2: register the paper stage + flip the terminal to `paper_ready`

**Files:**
- Modify: `src/lib/v2/domain.ts`, `src/lib/research/stages.ts`, `src/lib/research/router.ts`
- Modify: `tests/domain.test.ts`, `tests/research-stages.test.ts`, `tests/research-router.test.ts`

- [ ] **Step 1: Write/extend failing unit tests**

(a) In `tests/domain.test.ts`, find the test asserting `RESEARCH_PROJECT_STATUSES` contents and add `"paper_ready"` to its expectation (read the file; it likely does `expect(RESEARCH_PROJECT_STATUSES).toEqual([...])` or checks membership). If it's an exact `toEqual`, insert `"paper_ready"` in the same position as the source (after `"analysis_ready"`, before `"needs_review"`).

(b) In `tests/research-stages.test.ts`, add:

```ts
  it("includes paper as an executable stage with a registry entry", () => {
    expect(EXECUTABLE_STAGES).toContain("paper");
    expect(STAGE_REGISTRY.paper).toBeDefined();
    expect(STAGE_REGISTRY.paper.requiresSourcePaperCitation).toBe(true);
    expect(stagesAfter("analysis")).toEqual(["paper"]);
    expect(stagesAfter("paper")).toEqual([]);
  });
```

Add `EXECUTABLE_STAGES`, `STAGE_REGISTRY` to the imports if not present.

(c) In `tests/research-router.test.ts`, REPLACE the existing test `"PASS on analysis (no next stage) terminates analysis_ready"` with the new terminal behavior:

```ts
  it("PASS on analysis advances to the paper producer", () => {
    const action = routeAfterCritic(verdict({ verdict: "PASS", stageType: "analysis" }), project, { attempt: 1 });
    expect(action).toEqual({ type: "enqueue_producer", stage: "paper", attempt: 1, feedback: null, incrementProducerRuns: true });
  });

  it("PASS on paper (no next stage) terminates paper_ready", () => {
    const action = routeAfterCritic(verdict({ verdict: "PASS", stageType: "paper" }), project, { attempt: 1 });
    expect(action).toEqual({ type: "set_status", status: "paper_ready" });
  });
```

Also update the other router test that referenced the terminal — `"PASS still terminates even at the producer-run cap (no new run needed)"` uses `stageType: "analysis"` expecting `analysis_ready`; change its `stageType` to `"paper"` and expected status to `"paper_ready"`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/domain.test.ts tests/research-stages.test.ts tests/research-router.test.ts`
Expected: FAIL — `paper_ready` missing; `paper` not executable; router still returns `analysis_ready` / treats analysis as terminal.

- [ ] **Step 3: Add `paper_ready` to the statuses**

In `src/lib/v2/domain.ts`, in `RESEARCH_PROJECT_STATUSES`, add `"paper_ready"` after `"analysis_ready"`:

```ts
  "analysis_ready",
  "paper_ready",
  "needs_review",
```

- [ ] **Step 4: Register the paper stage**

In `src/lib/research/stages.ts`: add `PaperResultSchema` to the import from `@/lib/v2/schemas`; add `"paper"` to `EXECUTABLE_STAGES`; add the registry entry.

```ts
export const EXECUTABLE_STAGES = ["plan", "literature", "experiment", "analysis", "paper"] as const;
```
```ts
export const STAGE_REGISTRY: Record<ExecutableStage, StageDefinition> = {
  plan: { outputSchema: ResearchPlanSchema, requiresSourcePaperCitation: true },
  literature: { outputSchema: LiteratureReviewSchema, requiresSourcePaperCitation: true },
  experiment: { outputSchema: ExperimentResultSchema, requiresSourcePaperCitation: true },
  analysis: { outputSchema: AnalysisResultSchema, requiresSourcePaperCitation: true },
  paper: { outputSchema: PaperResultSchema, requiresSourcePaperCitation: true }
};
```

- [ ] **Step 5: Flip the router terminal status**

In `src/lib/research/router.ts`, in `routeAfterCritic`, the PASS branch currently returns `{ type: "set_status", status: "analysis_ready" }` when there is no next stage. Change that literal to `"paper_ready"`:

```ts
  if (verdict.verdict === "PASS") {
    const [next] = stagesAfter(stage);
    if (!next) return { type: "set_status", status: "paper_ready" };
    return {
      type: "enqueue_producer",
      stage: next,
      attempt: 1,
      feedback: null,
      incrementProducerRuns: true
    };
  }
```

- [ ] **Step 6: Run the unit tests and watch them pass**

Run: `npx vitest run tests/domain.test.ts tests/research-stages.test.ts tests/research-router.test.ts`
Expected: PASS.

- [ ] **Step 7: Update the Postgres tests that asserted analysis is terminal**

These now break because analysis PASS enqueues a paper producer instead of going `analysis_ready`. Update both:

(a) `tests/research-lifecycle.test.ts`. First add a `paperOutput` builder + an `advanceToPaperCriticClaim` helper next to the existing `analysisOutput`/`advanceToAnalysisClaim` (which look exactly like this in the file):

```ts
function paperOutput(researchProjectId: string, paper: { arxivId: string; url: string }) {
  return {
    researchProjectId,
    relationToSourcePaper: "Writes up the study extending the source paper.",
    title: "A Study Extending the Source Method",
    abstract: "We extend and evaluate the source method on a public benchmark.",
    noveltyStatement: "First public-benchmark evaluation of the method with ablations.",
    sections: ["Introduction", "Method", "Experiments", "Results", "Conclusion"],
    texPath: "paper/main.tex",
    pdfPath: "paper/main.pdf",
    compiled: true,
    artifacts: [{ path: "paper/main.pdf", caption: "Compiled paper", kind: "pdf" as const, bytes: 200000 }],
    summary: "A submittable workshop-grade draft.",
    citations: [
      { sourceType: "paper" as const, url: paper.url, sourceId: paper.arxivId, title: "Source paper", claim: "Original method.", confidence: 0.9 }
    ]
  };
}

async function advanceToPaperCriticClaim(
  db: PrismaClient,
  ids: { user: { id: string }; idea: { id: string }; paper: { arxivId: string; url: string } }
) {
  // plan/literature/experiment producers+critics -> analysis producer claim
  const analysisProducer = await advanceToAnalysisClaim(db, ids);
  await completeResearchStageJob({
    jobId: analysisProducer!.id, workerId: "w",
    output: analysisOutput(analysisProducer!.researchProjectId, ids.paper)
  });
  // analysis critic PASS -> paper producer claim
  const analysisCritic = await claimNextResearchStageJob({ userId: ids.user.id, workerId: "w" });
  const paperProducer = await passCriticAndClaimNext(db, ids, analysisCritic!);
  await completeResearchStageJob({
    jobId: paperProducer!.id, workerId: "w",
    output: paperOutput(paperProducer!.researchProjectId, ids.paper)
  });
  // paper critic claim
  return claimNextResearchStageJob({ userId: ids.user.id, workerId: "w" });
}
```

Then update the existing test (currently `"analysis completion + critic PASS sets the project analysis_ready and persists the artifact"`). Rename it to `"analysis completion + critic PASS advances to the paper producer"` and REPLACE its tail (from `const project = …` through the `analysisArtifact` assertion) with:

```ts
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: ana!.researchProjectId } });
      expect(project).toMatchObject({ currentStage: "paper", status: "running" });
      const paperJob = await db.researchStageJob.findFirst({
        where: { researchProjectId: project.id, stageType: "paper", kind: "producer", status: "queued" }
      });
      expect(paperJob).not.toBeNull();
      const analysisArtifact = await db.researchStageArtifact.findFirst({
        where: { researchProjectId: project.id, stageType: "analysis", supersededAt: null }
      });
      expect(analysisArtifact).not.toBeNull();
```

Then ADD a new test driving the paper stage to terminal:

```ts
  it("paper completion + critic PASS sets the project paper_ready", async () => {
    await withPostgresTestDatabase(async (db) => {
      mocked.prisma = db;
      const { user, idea, paper } = await seedIdea(db);
      const paperCritic = await advanceToPaperCriticClaim(db, { user, idea, paper: { arxivId: paper.arxivId, url: paper.url } });
      expect(paperCritic?.stageType).toBe("paper");
      expect(paperCritic?.kind).toBe("critic");
      await completeResearchStageJob({
        jobId: paperCritic!.id, workerId: "w",
        output: passVerdict(paperCritic!.researchProjectId, "paper")
      });
      const project = await db.researchProject.findUniqueOrThrow({ where: { id: paperCritic!.researchProjectId } });
      expect(project.status).toBe("paper_ready");
      const paperArtifact = await db.researchStageArtifact.findFirst({
        where: { researchProjectId: project.id, stageType: "paper", supersededAt: null }
      });
      expect(paperArtifact).not.toBeNull();
    });
  });
```

(b) `tests/research-worker-routes.test.ts` — the test "completes a research_analysis job and sets the project analysis_ready" (it claims + completes the analysis producer, then claims + completes the analysis critic with PASS, then asserts `analysis_ready`). Change its final assertions: after the analysis critic PASS, assert `status === "running"`, `currentStage === "paper"`, and a queued `research paper producer` job exists (NOT `analysis_ready`).

- [ ] **Step 8: Run the Postgres tests (serially) and watch them pass**

Run:
```bash
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/')
npx vitest run tests/research-lifecycle.test.ts --testTimeout=120000 --hookTimeout=120000
npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: PASS.

- [ ] **Step 9: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).
```bash
git add src/lib/v2/domain.ts src/lib/research/stages.ts src/lib/research/router.ts tests/domain.test.ts tests/research-stages.test.ts tests/research-router.test.ts tests/research-lifecycle.test.ts tests/research-worker-routes.test.ts
git commit -m "feat: register paper stage; analysis advances to paper; terminal is paper_ready (Phase 4)"
```

---

## Task 3: paper critic criteria (the strictest gate)

**Files:**
- Modify: `src/lib/research/critic-criteria.ts`
- Modify: `tests/critic-criteria.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/critic-criteria.test.ts`, add:

```ts
  it("defines the strictest paper gate: claims trace to analysis, PDF compiles, backtrack to analysis", () => {
    const paper = CRITIC_CRITERIA.paper;
    const text = paper.criteria.join(" ").toLowerCase();
    expect(text).toContain("compil");      // "compiles to a PDF"
    expect(text).toContain("citation");
    expect(text).toContain("novelt");
    expect(paper.routingGuidance.toLowerCase()).toContain("backtrack to analysis");
  });
```

> The existing `EXECUTABLE_STAGES` loop test in this file already iterates all executable stages — once `paper` is executable (Task 2) it will require a `CRITIC_CRITERIA.paper` entry to exist, so this test plus that loop both pin it.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/critic-criteria.test.ts`
Expected: FAIL — `CRITIC_CRITERIA.paper` is undefined (and the executable-stage loop test also fails).

- [ ] **Step 3: Add the `paper` criteria entry**

In `src/lib/research/critic-criteria.ts`, add to `CRITIC_CRITERIA` (after `analysis`):

```ts
  paper: {
    criteria: [
      "Every empirical claim and number traces to an analysis result: cross-check each figure, number, and claim against UPSTREAM_analysis.json (and the analysis/ artifacts). No invented numbers, no claims the analysis does not support.",
      "Every citation is real and verifiable: each reference resolves to a real paper (URL/DOI) — spot-check with web search — and the source paper is cited.",
      "Figures and tables are present and referenced: the artifacts the paper claims exist with sensible sizes and are referenced in the text.",
      "Novelty is explicit relative to the source paper: the paper states a concrete contribution beyond the source paper, not a restatement.",
      "Method is reproducible from the text: a reader could re-run the study from the described method and protocol.",
      "The LaTeX compiles to a PDF: a non-empty compiled PDF exists (compiled is true and a 'pdf' artifact / pdfPath with bytes > 0). If compilation failed, this criterion fails."
    ],
    routingGuidance:
      "This is the strictest gate — default to rejection unless the paper is genuinely submittable. If any empirical claim is unsupported by the analysis (or the data cannot support it), BACKTRACK to analysis. Writing, structure, missing-section, citation-format, or compilation problems that do not need new results are REDO."
  }
```

- [ ] **Step 4: Run + typecheck + commit**

Run: `npx vitest run tests/critic-criteria.test.ts` (expect PASS); `npx tsc --noEmit` (expect clean).
```bash
git add src/lib/research/critic-criteria.ts tests/critic-criteria.test.ts
git commit -m "feat: strictest paper critic criteria (claims trace, PDF compiles, novelty) (Phase 4)"
```

---

## Task 4: lane + the three job-type whitelists

**Files:**
- Modify: `src/lib/workers/lanes.ts`, `src/app/api/workers/jobs/[jobId]/complete/route.ts`, `scripts/researchfinder-worker.ts`
- Modify: `tests/worker-lanes.test.ts`

- [ ] **Step 1: Write the failing lane test**

In `tests/worker-lanes.test.ts`, add (or extend an existing membership test):

```ts
  it("includes the paper producer + critic in the research and both lanes", () => {
    expect(WORKER_JOB_TYPES).toContain("research_paper");
    expect(WORKER_JOB_TYPES).toContain("research_paper_critic");
    expect(laneClaimsJobType("research", "research_paper")).toBe(true);
    expect(laneClaimsJobType("research", "research_paper_critic")).toBe(true);
    expect(laneClaimsJobType("both", "research_paper")).toBe(true);
    expect(laneClaimsJobType("inbox", "research_paper")).toBe(false);
  });
```

Add `WORKER_JOB_TYPES`, `laneClaimsJobType` to imports if missing.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/worker-lanes.test.ts`
Expected: FAIL — `research_paper`/`research_paper_critic` not in `WORKER_JOB_TYPES`.

- [ ] **Step 3: Add to `lanes.ts`**

In `src/lib/workers/lanes.ts`, add `"research_paper"` and `"research_paper_critic"` to `WORKER_JOB_TYPES` (after the analysis entries), and to both the `research` and `both` arrays in `LANE_JOB_TYPES`. Place `"research_paper"` after `"research_analysis"` and `"research_paper_critic"` after `"research_analysis_critic"` in each list.

- [ ] **Step 4: Add to the complete route (3 spots)**

In `src/app/api/workers/jobs/[jobId]/complete/route.ts`:
- the local `WorkerJobType` union (lines ~12-23): add `| "research_paper" | "research_paper_critic"`.
- `markWorkerJobFailed` research branch (the big `||` chain, ~147-156): add `input.jobType === "research_paper" || input.jobType === "research_paper_critic" ||`.
- `resolveJobType` requestedType whitelist (~176-189): add `input.requestedType === "research_paper" || input.requestedType === "research_paper_critic" ||`.

(The `resolveJobType` stage-job lookup at the bottom already builds `research_${stageType}` / `research_${stageType}_critic` dynamically — no change needed there.)

- [ ] **Step 5: Add to the worker claim whitelist**

In `scripts/researchfinder-worker.ts`, `parseClaimPayload` whitelist (the `job.type !== …` chain, ~388-400): add `&& job.type !== "research_paper" && job.type !== "research_paper_critic"`.

- [ ] **Step 6: Run + typecheck + commit**

Run: `npx vitest run tests/worker-lanes.test.ts` (expect PASS); `npx tsc --noEmit` (expect clean).
```bash
git add src/lib/workers/lanes.ts src/app/api/workers/jobs/[jobId]/complete/route.ts scripts/researchfinder-worker.ts tests/worker-lanes.test.ts
git commit -m "feat: register research_paper + research_paper_critic in lane + whitelists (Phase 4)"
```

---

## Task 5: claim route `buildPaperJobInput`

**Files:**
- Modify: `src/app/api/workers/claim/route.ts`
- Modify: `tests/research-worker-routes.test.ts`

- [ ] **Step 1: Write the failing Postgres route tests**

In `tests/research-worker-routes.test.ts`, add a seeder for a project at the paper stage (live plan+literature+experiment+analysis artifacts + a queued paper producer job) and tests that the claimed paper producer input carries the upstream subsets + feedback. Model the seeder on `seedProjectWithAnalysisJob` (read it) but at `currentStage: "paper"`, with all four upstream artifacts present and a `paper` producer job (with `feedback`). The four artifacts must be valid for their schemas (reuse the analysis seeder's plan/literature/experiment artifact JSON; for analysis use a valid `AnalysisResult`). Then:

```ts
  it("claims a research_paper job and returns input with plan, literature, experiment, analysis + feedback", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithPaperJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };
      const response = await POST(new Request("http://localhost/api/workers/claim", { method: "POST", headers: { authorization: "Bearer t" } }));
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        job: { type: string; input: { plan: unknown; literature: unknown; experiment: unknown; analysis: unknown; feedback?: string } };
      };
      expect(payload.job.type).toBe("research_paper");
      expect(payload.job.input.plan).toBeTruthy();
      expect(payload.job.input.literature).toBeTruthy();
      expect(payload.job.input.experiment).toBeTruthy();
      expect(payload.job.input.analysis).toBeTruthy();
      expect(payload.job.input.feedback).toBe("Prior critic: tighten the abstract.");
    });
  });
```

> Set `feedback: "Prior critic: tighten the abstract."` on the seeded paper job. The paper CRITIC claim is already covered generically by `buildStageCriticJobInput` (stagesBefore("paper") = all four); optionally add a paper-critic claim test asserting `upstreamArtifacts.map(u=>u.stageType)` equals `["plan","literature","experiment","analysis"]`.

- [ ] **Step 2: Run it and watch it fail**

Run:
```bash
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: FAIL — claiming the paper producer hits the producer switch with no `paper` case (error / 500), so the input is never built.

- [ ] **Step 3: Add `buildPaperJobInput` + wire it into the producer switch**

In `src/app/api/workers/claim/route.ts`:
- import `PaperJobInputSchema`, `type PaperJobInput`, and `AnalysisResultSchema` (if not already imported) from `@/lib/v2/schemas`.
- Add the builder (model on `buildAnalysisJobInput`; it reads the live plan/literature/experiment/analysis artifacts via `findLiveArtifact`):

```ts
async function buildPaperJobInput(job: ClaimedResearchStageJob): Promise<PaperJobInput> {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;

  const planArtifact = findLiveArtifact(job, "plan");
  const litArtifact = findLiveArtifact(job, "literature");
  const expArtifact = findLiveArtifact(job, "experiment");
  const analysisArtifact = findLiveArtifact(job, "analysis");
  if (!planArtifact || !litArtifact || !expArtifact || !analysisArtifact) {
    throw new Error("Paper stage requires completed plan, literature, experiment, and analysis artifacts");
  }
  const plan = ResearchPlanSchema.parse(JSON.parse(planArtifact.artifactJson));
  const literature = LiteratureReviewSchema.parse(JSON.parse(litArtifact.artifactJson));
  const experiment = ExperimentResultSchema.parse(JSON.parse(expArtifact.artifactJson));
  const analysis = AnalysisResultSchema.parse(JSON.parse(analysisArtifact.artifactJson));

  return PaperJobInputSchema.parse({
    jobId: job.id,
    userId: job.userId,
    researchProjectId: job.researchProjectId,
    idea: {
      id: idea.id, title: idea.title, summary: idea.summary,
      expandedExplanation: idea.expandedExplanation, trajectory: idea.trajectory,
      smallestSprint: idea.smallestSprint
    },
    paper: {
      id: paper.id, arxivId: paper.arxivId, title: paper.title, abstract: paper.abstract, url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    plan: {
      relationToSourcePaper: plan.relationToSourcePaper,
      hypotheses: plan.hypotheses,
      successCriteria: plan.successCriteria,
      metrics: plan.metrics,
      baselines: plan.baselines,
      experimentalDesign: plan.experimentalDesign
    },
    literature: { positioning: literature.positioning, gaps: literature.gaps },
    experiment: { summary: experiment.summary, verdict: experiment.verdict, findings: experiment.findings },
    analysis: {
      summary: analysis.summary, verdict: analysis.verdict, keyFindings: analysis.keyFindings,
      comparisonToBaselines: analysis.comparisonToBaselines
    },
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    })),
    feedback: job.feedback ?? undefined
  });
}
```

- Wire it into the producer-type switch (where `research_analysis` etc. map to their builders). The critic branch (`job.kind === "critic"`) already handles paper critics generically. Add a `paper` case so a `kind: "producer"` paper job returns `{ type: "research_paper", input: await buildPaperJobInput(job) }` exactly like the analysis case does for `research_analysis`. (Read the existing producer dispatch in this file and mirror the analysis arm.)

- [ ] **Step 4: Run the route tests (serially) and watch them pass**

Run:
```bash
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).
```bash
git add src/app/api/workers/claim/route.ts tests/research-worker-routes.test.ts
git commit -m "feat: claim route builds paper job input from all upstream artifacts (Phase 4)"
```

---

## Task 6: worker `runPaperJob` + `buildPaperPrompt` + dispatch

**Files:**
- Modify: `scripts/researchfinder-worker.ts`
- Modify: `tests/researchfinder-worker.test.ts`

- [ ] **Step 1: Write the failing worker test**

In `tests/researchfinder-worker.test.ts`, add a test that claims a `research_paper` job and asserts the prompt + completion. Model it on the existing `research_analysis` test (which wires `runCodexAgentic` and captures `promptText`). The claimed job's `input` must be a valid `PaperJobInput` (mirror the schema test's `valid` object, plus a `feedback`). The fake `runCodexAgentic` returns a valid `PaperResult` JSON (compiled true, citing the source paper). Assertions:

```ts
    expect(processed).toBe(true);
    expect(runCodexAgentic).toHaveBeenCalledTimes(1);
    expect(promptText.toLowerCase()).toContain("latex");
    expect(promptText.toLowerCase()).toContain("tectonic");
    expect(promptText).toContain("paper/main.tex");
    expect(promptText).toContain("Prior critic: tighten the abstract.");
    const completionBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(completionBody.type).toBe("research_paper");
    expect(completionBody.output.compiled).toBe(true);
```

(Set `feedback: "Prior critic: tighten the abstract."` in the job input.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: FAIL — `research_paper` is rejected by `parseClaimPayload`? No (Task 4 whitelisted it); it fails because there is no `runPaperJob`/dispatch, so the worker throws "Unsupported worker job type" is gone but no handler returns → it falls through. (Either way, red.)

- [ ] **Step 3: Add `paperWorkspaceDirs`, `parsePaperJobInput`, `buildPaperPrompt`, `runPaperJob`**

In `scripts/researchfinder-worker.ts`, near the analysis runner, add:

```ts
function paperWorkspaceDirs(researchProjectId: string) {
  const root =
    process.env.RESEARCHFINDER_EXPERIMENT_WORKSPACE_ROOT ??
    join(process.cwd(), ".research-workspaces");
  const projectRoot = join(root, researchProjectId);
  return { projectRoot, paperDir: join(projectRoot, "paper") };
}

function parsePaperJobInput(value: unknown) {
  try {
    return PaperJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(`Paper job input failed validation: ${formatErrorMessage(error)}`);
  }
}

function buildPaperPrompt(input: PaperJobInput) {
  return [
    "You are assembling a COMPLETE, submittable academic paper in your current working directory.",
    "The experiment and analysis raw outputs are in the experiment/ and analysis/ subdirectories",
    "(figures and tables the analysis produced are under analysis/). The full task input (idea, source",
    "paper, plan, literature, experiment + analysis results) is in paper/INPUT.json — read it first.",
    "Write the paper as LaTeX to paper/main.tex with the standard structure: Title, Abstract, Introduction,",
    "Related Work, Method, Experiments, Results, Discussion, Limitations, Conclusion, References. Embed the",
    "analysis figures/tables (reference the files under analysis/). State the novel contribution explicitly",
    "relative to the source paper.",
    "Then COMPILE it to a PDF locally: run `tectonic paper/main.tex` (preferred) or `pdflatex` in paper/.",
    "Every empirical claim and number MUST come from the analysis results — do not invent numbers. Every",
    "citation must be a real, resolvable reference, and you MUST cite the source paper.",
    "When finished, output ONLY valid JSON matching the PaperResult schema as your final message. Do not wrap it in Markdown.",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    "Required keys: researchProjectId, relationToSourcePaper, title, abstract, noveltyStatement,",
    "sections (>=1, the section headings you included), texPath (e.g. \"paper/main.tex\"), pdfPath (e.g. \"paper/main.pdf\"),",
    "compiled (true only if the PDF actually built), artifacts (each {path, caption, kind: figure|table|pdf|tex, bytes}),",
    "summary, citations (>=1).",
    "If the PDF genuinely cannot be compiled (no LaTeX toolchain), set compiled=false and explain in summary —",
    "do NOT fabricate a PDF.",
    "Ground in the source paper: relationToSourcePaper must explain how this paper relates to it,",
    'and citations MUST include the source paper as sourceType "paper" with its exact url and sourceId.',
    ...buildPriorFeedbackSection(input.feedback)
  ].join("\n");
}

async function runPaperJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parsePaperJobInput(job.input);
  const { paperDir } = paperWorkspaceDirs(input.researchProjectId);
  await mkdir(paperDir, { recursive: true });
  await writeFile(join(paperDir, "INPUT.json"), JSON.stringify(input, null, 2), "utf8");

  const { projectRoot } = paperWorkspaceDirs(input.researchProjectId);
  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-paper-"));
  const promptFile = join(promptDir, `${job.id}.prompt.md`);
  await writeFile(promptFile, buildPaperPrompt(input), "utf8");

  const controller = new AbortController();
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const heartbeat = setInterval(() => {
    void sendWorkerHeartbeat(config, job.id)
      .then((result) => {
        if (result?.aborted) controller.abort();
      })
      .catch((error) => {
        console.warn(`Heartbeat failed (continuing): ${formatErrorMessage(error)}`);
      });
  }, heartbeatMs);

  try {
    let rawOutput: string;
    try {
      rawOutput = await (options.runCodexAgentic ?? defaultRunCodexAgentic)(promptFile, {
        workspaceDir: projectRoot,
        codexCommand: config.codexCommand,
        signal: controller.signal
      });
    } catch (error) {
      const message = controller.signal.aborted ? "Paper aborted by user" : formatErrorMessage(error);
      await failWorkerJob(config, job, new Error(message));
      throw new ProcessedWorkerError(error);
    }

    try {
      return { output: parseResearchStageOutput("paper", rawOutput) };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    clearInterval(heartbeat);
    await rm(promptDir, { force: true, recursive: true });
  }
}
```

Add `PaperJobInput`, `PaperJobInputSchema` to the worker's import from `@/lib/v2/schemas`.

- [ ] **Step 4: Wire dispatch**

In `runResearchFinderWorkerOnce`, add a producer arm (mirror the `research_analysis` arm) BEFORE the critic OR-block:

```ts
  if (payload.job.type === "research_paper") {
    const result = await runPaperJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }
```

And add `research_paper_critic` to the existing critic dispatch OR-condition:

```ts
  if (
    payload.job.type === "research_plan_critic" ||
    payload.job.type === "research_literature_critic" ||
    payload.job.type === "research_experiment_critic" ||
    payload.job.type === "research_analysis_critic" ||
    payload.job.type === "research_paper_critic"
  ) {
```

- [ ] **Step 5: Run + typecheck + commit**

Run: `npx vitest run tests/researchfinder-worker.test.ts` (expect PASS); `npx tsc --noEmit` (expect clean).
```bash
git add scripts/researchfinder-worker.ts tests/researchfinder-worker.test.ts
git commit -m "feat: worker paper producer (LaTeX->PDF agentic run) + dispatch (Phase 4)"
```

---

## Task 7: detail page paper section

**Files:**
- Modify: `src/app/research/[projectId]/page.tsx`

- [ ] **Step 1: Render the paper artifact**

In `src/app/research/[projectId]/page.tsx`:
- add `PaperResultSchema` to the import from `@/lib/v2/schemas`.
- after the `analysis` parse block (~line 57-63), add:

```tsx
  const paperArtifact = artifactByStage.get("paper");
  const paperDoc = paperArtifact
    ? (() => {
        const r = PaperResultSchema.safeParse(JSON.parse(paperArtifact.artifactJson));
        return r.success ? r.data : null;
      })()
    : null;
```

- after the `analysis ? (...) : null` section (~line 342), add a paper section:

```tsx
        {paperDoc ? (
          <section className="mt-4 grid gap-4 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            <div>
              <h2 className="text-lg font-semibold text-rf-white">Paper</h2>
              <p className="mt-1">
                <StatusBadge status={paperDoc.compiled ? "compiled" : "not compiled"} /> {paperDoc.title}
              </p>
              <p className="mt-1">{paperDoc.relationToSourcePaper}</p>
            </div>
            <div>
              <h3 className="font-semibold text-rf-white">Abstract</h3>
              <p className="mt-1">{paperDoc.abstract}</p>
            </div>
            <div>
              <h3 className="font-semibold text-rf-white">Novelty</h3>
              <p className="mt-1">{paperDoc.noveltyStatement}</p>
            </div>
            <PlanList title="Sections" items={paperDoc.sections} />
            <div>
              <h3 className="font-semibold text-rf-white">Files</h3>
              <ul className="mt-1 grid gap-1">
                <li><span className="text-rf-white">{paperDoc.texPath}</span> (LaTeX source)</li>
                <li><span className="text-rf-white">{paperDoc.pdfPath}</span> (compiled PDF)</li>
              </ul>
            </div>
            {paperDoc.artifacts.length > 0 ? (
              <div>
                <h3 className="font-semibold text-rf-white">Artifacts</h3>
                <ul className="mt-1 grid gap-1">
                  {paperDoc.artifacts.map((artifact, index) => (
                    <li key={`${artifact.path}-${index}`}>
                      <span className="text-rf-white">{artifact.path}</span> — {artifact.caption}{" "}
                      <span className="text-rf-muted">({artifact.kind}, {artifact.bytes} bytes)</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <h3 className="font-semibold text-rf-white">Citations</h3>
              <ul className="mt-1 grid gap-1">
                {paperDoc.citations.map((citation, index) => (
                  <li key={`${citation.title}-${index}`}>
                    {citation.url ? (
                      <a className="text-rf-violetSoft" href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>
                    ) : (
                      <span className="text-rf-white">{citation.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
```

- update the empty-state condition (~line 344) from `!plan && !literature && !experiment && !analysis` to also require `!paperDoc`:

```tsx
        {!plan && !literature && !experiment && !analysis && !paperDoc ? (
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (This server component has no unit-test harness; tsc + the existing suite are the gate.)

- [ ] **Step 3: Commit**

```bash
git add src/app/research/[projectId]/page.tsx
git commit -m "feat: render the paper stage on the research detail page (Phase 4)"
```

---

## Task 8: final verification

No code. Verify the whole phase is green and typechecks.

- [ ] **Step 1: Fast suites**

Run:
```bash
npx vitest run tests/research-schemas.test.ts tests/domain.test.ts tests/research-stages.test.ts tests/research-router.test.ts tests/critic-criteria.test.ts tests/critic-verdict-schema.test.ts tests/worker-lanes.test.ts tests/worker-output-validation.test.ts tests/researchfinder-worker.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Postgres suites (serially)**

Run each on its own:
```bash
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/')
npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
npx vitest run tests/research-lifecycle.test.ts --testTimeout=120000 --hookTimeout=120000
npx vitest run tests/research-complete-route-critic.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: all PASS.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

---

## Spec coverage (self-review)

| Master-spec `paper` requirement | Task |
|---|---|
| Producer assembles all upstream artifacts into a full paper | 5 (input) + 6 (prompt/runner) |
| Output is LaTeX compiled to PDF locally (`tectonic`/`pdflatex`) | 6 (prompt instructs compile; `compiled` flag) |
| Standard structure + figures embedded + novelty vs source | 1 (schema `sections`/`noveltyStatement`) + 6 (prompt) |
| Strictest critic: claims trace, citations real, figures present, novelty, reproducible, compiles | 3 (criteria) + existing generic critic |
| Deliverable = `.tex` + `.pdf` + figures local; dashboard shows metadata + paths + verdict | 6 (workspace files) + 7 (detail page) |
| Termination: paper critic PASS → `paper_ready` | 2 (router terminal + status) |
| Claims results don't support → BACKTRACK to analysis | 3 (routing guidance) + Phase-2 upstream-only schema rule |

**Out of scope (deferred):** the `literature→plan` reorder (its own later phase); the loop observability dashboard (Phase 5); re-running a `needs_review`/`failed` project; rendering the PDF inside the hosted dashboard (artifacts stay local, opened by the user).

## Traceability — exact names introduced

- `PaperResultSchema`, `PaperJobInputSchema`, `PaperResult`, `PaperJobInput` (`schemas.ts`); `RESEARCH_STAGE_SCHEMAS.paper` (`output-validation.ts`)
- `RESEARCH_PROJECT_STATUSES` += `"paper_ready"`; `EXECUTABLE_STAGES` += `"paper"`; `STAGE_REGISTRY.paper`; router terminal `"paper_ready"`
- `CRITIC_CRITERIA.paper`
- `WORKER_JOB_TYPES`/`LANE_JOB_TYPES` += `research_paper`, `research_paper_critic`; same in the complete-route union/whitelist + worker `parseClaimPayload`
- `buildPaperJobInput` (claim route); `runPaperJob`/`buildPaperPrompt`/`parsePaperJobInput`/`paperWorkspaceDirs` (worker); `research_paper` producer dispatch + `research_paper_critic` critic dispatch
- workspace files `paper/INPUT.json`, `paper/main.tex`, `paper/main.pdf`
