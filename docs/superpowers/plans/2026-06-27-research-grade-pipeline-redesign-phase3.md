# Research-Grade Pipeline Redesign — Phase 3 (Producer Overhaul + Feedback Injection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the producers research-grade — rewrite all four producer prompts to demand real data, full-scale rigor, and no fabrication (removing the "smallest/minimal" framing), and feed each re-dispatched producer the critic's prior feedback so a REDO/BACKTRACK actually changes the output.

**Architecture:** The critic loop (Phases 1–2) already stores the critic's `feedback` on the re-enqueued producer job. Phase 3 threads that `feedback` through the producer job input (claim route) into the producer prompts (worker), and overhauls the prompt *content* of all four producers (`plan`, `experiment`, `analysis`, `literature`) for real-data/rigor/no-fabrication. It also adds an optional `availableResources` field to `LiteratureReviewSchema` so the literature producer can surface the datasets/code inventory the Phase-2 literature critic already checks for. No DB migration; no state-machine or routing changes.

**Tech Stack:** TypeScript, Next.js App Router (worker claim route), Zod (`strictObject`, `CoercibleString`), Prisma/Postgres, Vitest (+ Postgres-backed route tests), the tsx worker (`scripts/researchfinder-worker.ts`), Codex CLI (`runCodexAgentic`/`runCodex`).

---

## Context the engineer needs (read before starting)

- **Master spec:** `docs/superpowers/specs/2026-06-27-research-grade-pipeline-redesign-design.md` — Phase 3 in "Build phasing" is "Producer overhaul — rewrite prompts for real-data/rigor/feasibility/no-fabrication across literature/plan/experiment/analysis; apply the literature→plan reorder." See also the per-stage *producer* descriptions in "Per-stage producers + critic criteria".
- **Scope note — the `literature→plan` reorder is DEFERRED to a later phase**, not done here. It is structurally invasive (it flips the first stage, swaps the plan↔literature upstream wiring and their input schemas, and churns many order-pinned tests) and has little direct quality impact compared with the prompt overhaul. This plan keeps the **current** order (`plan → literature → experiment → analysis`). Because of that, the plan producer still runs first and does NOT receive a literature artifact, and the literature producer still receives the `plan` (as today). Do not change stage order or the plan/literature upstream wiring.
- **Phases 1–2 are built** on branch `feat/research-grade-pipeline-redesign`. The producer→critic loop, the router, the per-stage critic criteria, and `CriticVerdictSchema` exist and are green. The router already writes `feedback` onto re-enqueued producer jobs (`src/lib/jobs/research.ts` `completeCriticJob`: both the `enqueue_producer` and `backtrack` branches set `feedback`). The `ResearchStageJob.feedback` column exists. The claim route currently builds producer inputs WITHOUT feedback; the worker prompts don't use it. Phase 3 closes that loop.
- **The toy-inducing prompt lines to remove** (the whole reason for the redesign):
  - `scripts/researchfinder-worker.ts:570` (plan): `"Keep the plan to the smallest credible experiment that tests the core hypothesis."`
  - `scripts/researchfinder-worker.ts:644` (experiment): `"You are running a real, minimal research experiment in your current working directory."`
  - `scripts/researchfinder-worker.ts:646` (experiment): `"Implement and ACTUALLY RUN the smallest credible experiment that tests the plan's hypotheses:"`
- **The user's locked constraints** (keep these true in the new prompts): real public data only, never toy/fabricated; engine is Codex on the subscription — agents may use the open web + any non-LLM data APIs (arXiv/OpenAlex/HuggingFace/GitHub/Kaggle/etc.) but **no paid LLM API keys**; a single agent running for many hours doing exhaustive work is desired, not a problem.

### Environment / commands

- Use `npx` directly. No `prisma generate` needed (no schema-shape change to Prisma models; the Zod schema change in Task 5 is app-level only).
- **Postgres-backed tests** (`research-worker-routes`) need the port-swapped env + long timeouts, run one file at a time:
  ```bash
  export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run <file> --testTimeout=120000 --hookTimeout=120000
  ```
- Fast suites need no DB: `npx vitest run <file>`.
- **Do NOT run the full suite** (it hangs). `npx tsc --noEmit` after each task.

---

## Cross-task name contract (use these exact names)

- The four producer input schemas in `src/lib/v2/schemas.ts` each gain: `feedback: NonEmptyTrimmedStringSchema.optional()`
  - `ResearchPlanJobInputSchema`, `LiteratureJobInputSchema`, `ExperimentJobInputSchema`, `AnalysisJobInputSchema`
- The four producer input builders in `src/app/api/workers/claim/route.ts` each add `feedback: job.feedback ?? undefined` to their returned object:
  - `buildResearchPlanJobInput`, `buildLiteratureJobInput`, `buildExperimentJobInput`, `buildAnalysisJobInput`
- `scripts/researchfinder-worker.ts` gains a shared helper:
  - `function buildPriorFeedbackSection(feedback?: string | null): string[]`
  used (spread) inside all four producer prompt builders: `buildResearchPlanPrompt`, `buildExperimentPrompt`, `buildAnalysisPrompt`, `buildLiteraturePrompt`.
- `src/lib/v2/schemas.ts` `LiteratureReviewSchema` gains: `availableResources: z.array(CoercibleString).optional()`

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/v2/schemas.ts` (modify) | `feedback?` on 4 producer input schemas | 1 |
| `src/app/api/workers/claim/route.ts` (modify) | pass `job.feedback` into 4 producer inputs | 1 |
| `tests/research-schemas.test.ts` (modify) | input schema accepts `feedback` | 1 |
| `tests/research-worker-routes.test.ts` (modify) | claim ships `feedback` to a re-dispatched producer | 1 |
| `scripts/researchfinder-worker.ts` (modify) | `buildPriorFeedbackSection` + plan prompt overhaul | 2 |
| `tests/researchfinder-worker.test.ts` (modify) | plan prompt: rigor + feedback + no "smallest" | 2 |
| `scripts/researchfinder-worker.ts` (modify) | experiment prompt overhaul | 3 |
| `tests/researchfinder-worker.test.ts` (modify) | experiment prompt: real/full + feedback; update old assertion | 3 |
| `scripts/researchfinder-worker.ts` (modify) | analysis prompt overhaul | 4 |
| `tests/researchfinder-worker.test.ts` (modify) | analysis prompt: rigorous stats + feedback | 4 |
| `src/lib/v2/schemas.ts` + `scripts/researchfinder-worker.ts` (modify) | literature `availableResources` + prompt overhaul | 5 |
| `tests/research-schemas.test.ts` + `tests/researchfinder-worker.test.ts` (modify) | literature schema + prompt | 5 |

---

## Task 1: thread the critic feedback into producer job inputs

**Files:**
- Modify: `src/lib/v2/schemas.ts` (4 producer input schemas)
- Modify: `src/app/api/workers/claim/route.ts` (4 producer input builders)
- Modify: `tests/research-schemas.test.ts`
- Modify: `tests/research-worker-routes.test.ts`

- [ ] **Step 1: Write the failing schema test**

In `tests/research-schemas.test.ts`, find the `describe("ResearchPlanJobInputSchema", …)` block. Add a test inside it:

```ts
  it("accepts an optional feedback string from a prior critic", () => {
    expect(ResearchPlanJobInputSchema.parse({ ...validJobInput, feedback: "Add seeds + ablations." }))
      .toMatchObject({ feedback: "Add seeds + ablations." });
    // still valid without feedback
    expect(ResearchPlanJobInputSchema.parse(validJobInput).feedback).toBeUndefined();
  });
```

(`validJobInput` already exists in that file.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/research-schemas.test.ts`
Expected: FAIL — `feedback` is an unknown key under `strictObject`, so `parse({...validJobInput, feedback})` throws.

- [ ] **Step 3: Add `feedback` to the four producer input schemas**

In `src/lib/v2/schemas.ts`, add `feedback: NonEmptyTrimmedStringSchema.optional(),` as the last property (before the closing `})`) of each of these four schemas: `ResearchPlanJobInputSchema` (ends ~line 335), `LiteratureJobInputSchema` (ends ~line 384), `ExperimentJobInputSchema` (ends ~line 423), `AnalysisJobInputSchema` (ends ~line 520). Example for the plan schema:

```ts
  citations: z.array(CitationSchema),
  feedback: NonEmptyTrimmedStringSchema.optional()
});
```

Do the identical addition to all four. (Each currently ends with `citations: z.array(CitationSchema)` — add the comma and the `feedback` line.)

- [ ] **Step 4: Run the schema test and watch it pass**

Run: `npx vitest run tests/research-schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing claim-route test**

In `tests/research-worker-routes.test.ts`, read the existing `seedProjectWithClaimableJob` seeder (it seeds a queued `plan` producer job) and the `research_plan worker routes` test. Add a new test in the `describe("research_plan worker routes", …)` block that seeds a plan producer job WITH feedback and asserts the claimed input carries it. Add a seeder variant next to `seedProjectWithClaimableJob` that sets `feedback` on the plan job:

```ts
async function seedProjectWithRedispatchedPlanJob(client: PrismaClient) {
  const user = await client.user.create({ data: { email: "worker-routes-redispatch@example.com" } });
  const worker = await client.workerRegistration.create({
    data: { userId: user.id, label: "w-redispatch", tokenHash: "h-redispatch", status: "active" }
  });
  const paper = await client.paper.create({
    data: {
      arxivId: "2502.00008", title: "Redispatch Src", abstract: "E",
      url: "https://arxiv.org/abs/2502.00008", publishedAt: new Date(), arxivUpdatedAt: new Date(),
      authorsJson: "[]", categoriesJson: "[]"
    }
  });
  const idea = await client.generatedIdea.create({
    data: {
      userId: user.id, paperId: paper.id, inboxDate: "2026-06-25", title: "Redispatch Idea", summary: "S",
      expandedExplanation: "E", trajectory: "Tr", recommended: true, noveltyStatus: "not_checked",
      relevanceScore: 0.8, significanceScore: 0.8, originalityScore: 0.8, feasibilityScore: 0.8,
      overallScore: 0.8, scoreExplanationsJson: "{}", risksJson: "[]", smallestSprint: "SS", generatedBy: "codex"
    }
  });
  const project = await client.researchProject.create({
    data: { userId: user.id, generatedIdeaId: idea.id, status: "running", currentStage: "plan" }
  });
  const job = await client.researchStageJob.create({
    data: {
      researchProjectId: project.id, userId: user.id, stageType: "plan", kind: "producer",
      attempt: 2, feedback: "Prior critic: add multiple seeds and an ablation.",
      status: "queued", inputJson: JSON.stringify({ researchProjectId: project.id })
    }
  });
  return { user, worker, paper, project, job };
}
```

Add the test:

```ts
  it("ships the prior critic feedback to a re-dispatched plan producer", async () => {
    const { POST } = await import("@/app/api/workers/claim/route");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const { worker } = await seedProjectWithRedispatchedPlanJob(client);
      mocked.worker = { id: worker.id, userId: worker.userId, lane: "both" };
      const response = await POST(
        new Request("http://localhost/api/workers/claim", {
          method: "POST", headers: { authorization: "Bearer t" }
        })
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { job: { type: string; input: { feedback?: string } } };
      expect(payload.job.type).toBe("research_plan");
      expect(payload.job.input.feedback).toBe("Prior critic: add multiple seeds and an ablation.");
    });
  });
```

- [ ] **Step 6: Run it and watch it fail**

Run:
```bash
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: FAIL — `payload.job.input.feedback` is `undefined` (the builder doesn't include it).

- [ ] **Step 7: Pass `job.feedback` in the four producer input builders**

In `src/app/api/workers/claim/route.ts`, in each of `buildResearchPlanJobInput`, `buildLiteratureJobInput`, `buildExperimentJobInput`, `buildAnalysisJobInput`, add `feedback: job.feedback ?? undefined` to the object passed to the corresponding `…JobInputSchema.parse({ … })`. Add it as the last property, after `citations`. Example (plan builder):

```ts
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    })),
    feedback: job.feedback ?? undefined
  });
```

> `job` is the `ClaimedResearchStageJob` (the full claimed row, which includes the scalar `feedback` column). `job.feedback` is `string | null`; `?? undefined` normalizes null → undefined for the optional schema field.

- [ ] **Step 8: Run both test files and watch them pass**

Run:
```bash
npx vitest run tests/research-schemas.test.ts
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/') && npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: both PASS (all prior tests + the two new ones).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/v2/schemas.ts src/app/api/workers/claim/route.ts tests/research-schemas.test.ts tests/research-worker-routes.test.ts
git commit -m "feat: thread critic feedback into producer job inputs (Phase 3)"
```

---

## Task 2: shared feedback section + plan prompt overhaul

**Files:**
- Modify: `scripts/researchfinder-worker.ts` (`buildPriorFeedbackSection`, `buildResearchPlanPrompt`)
- Modify: `tests/researchfinder-worker.test.ts`

- [ ] **Step 1: Write/extend the failing worker test for the plan prompt**

In `tests/researchfinder-worker.test.ts`, find the test that runs a `research_plan` job (it claims a `research_plan` job and captures `promptText`). If there is no `feedback` in that job's input, add a SECOND plan-prompt test that includes feedback, OR extend the existing one. Add this test (model its fetch/claim wiring on the existing `research_plan` test in the file; set the claimed job's `input.feedback`):

```ts
  it("plan prompt demands rigor, drops the 'smallest' framing, and injects prior feedback", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          job: {
            type: "research_plan",
            id: "plan-redo-1",
            input: {
              jobId: "plan-redo-1", userId: "u1", researchProjectId: "proj-1",
              idea: { id: "i1", title: "T", summary: "S", expandedExplanation: "E", trajectory: "Tr", smallestSprint: "SS" },
              paper: {
                id: "p1", arxivId: "2401.00001", title: "Src", abstract: "A.",
                url: "https://arxiv.org/abs/2401.00001", authors: [], categories: [],
                publishedAt: "2024-01-01T00:00:00.000Z"
              },
              viability: null,
              citations: [{ sourceType: "paper", title: "Src", url: "https://arxiv.org/abs/2401.00001", sourceId: "2401.00001", claim: "Foundational", confidence: 0.9 }],
              feedback: "Add multiple seeds and an ablation over depth."
            }
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    let promptText = "";
    const runCodex = vi.fn(async (promptPath: string) => {
      promptText = await readFile(promptPath, "utf8");
      return JSON.stringify({
        researchProjectId: "proj-1", relationToSourcePaper: "Extends src.",
        hypotheses: ["H1"], experimentalDesign: "D", protocolSteps: ["S1"], datasets: ["CIFAR-10"],
        baselines: ["ResNet-18"], metrics: ["acc"], successCriteria: ["beats baseline"], computeEstimate: "1 GPU-day",
        risks: ["r"], citations: [{ sourceType: "paper", title: "Src", url: "https://arxiv.org/abs/2401.00001", sourceId: "2401.00001", claim: "Foundational", confidence: 0.9 }]
      });
    });
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const processed = await runResearchFinderWorkerOnce(
      { appUrl: "https://research.example.com", workerToken: "worker-token", codexCommand: "codex-test" },
      { runCodex, maxIterations: 1 }
    );

    expect(processed).toBe(true);
    expect(promptText).not.toContain("smallest credible experiment");
    expect(promptText.toLowerCase()).toContain("real");
    expect(promptText.toLowerCase()).toContain("ablation");
    expect(promptText).toContain("Add multiple seeds and an ablation over depth.");
  });
```

> NOTE: the plan producer uses `options.runCodex` (NOT `runCodexAgentic`). Confirm by reading `runResearchPlanJob`/the plan dispatch in the worker; pass the fake under the correct option key.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: FAIL — prompt still contains "smallest credible experiment" and does not contain the feedback.

- [ ] **Step 3: Add the shared feedback helper**

In `scripts/researchfinder-worker.ts`, add (near the other prompt builders, e.g. just above `buildResearchPlanPrompt`):

```ts
function buildPriorFeedbackSection(feedback?: string | null): string[] {
  if (!feedback) return [];
  return [
    "",
    "A prior critic REJECTED an earlier attempt at this stage. You MUST directly and specifically",
    "address this feedback in your new output:",
    feedback,
    ""
  ];
}
```

- [ ] **Step 4: Overhaul `buildResearchPlanPrompt`**

Replace `buildResearchPlanPrompt` with:

```ts
function buildResearchPlanPrompt(input: ResearchPlanJobInput) {
  return [
    "You are turning a viability-checked research idea into a concrete, FEASIBLE, RIGOROUS research plan",
    "for a publishable study — not a demo.",
    "Return only valid JSON matching the ResearchPlan schema exactly. Do not wrap it in Markdown.",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    "Required keys: researchProjectId, relationToSourcePaper, hypotheses (>=1), experimentalDesign,",
    "protocolSteps (>=1, ordered), datasets, baselines, metrics, successCriteria (>=1),",
    "computeEstimate, risks, citations (>=1).",
    "hypotheses, protocolSteps, datasets, baselines, metrics, successCriteria, and risks are arrays of",
    "PLAIN STRINGS (one concise sentence per item, NOT objects). experimentalDesign, computeEstimate,",
    "and relationToSourcePaper are single plain strings. Example: \"hypotheses\": [\"X improves Y.\", \"...\"].",
    "Design the FULL study, not the smallest version:",
    "- Name REAL, publicly available datasets/benchmarks and how to obtain them — never invent toy data.",
    "- Specify concrete baselines, MULTIPLE seeds/repetitions, and ablations.",
    "- Include a concrete statistical-analysis plan (which tests, effect sizes, multiple-comparison handling).",
    "- successCriteria must be quantitative, decidable thresholds tied to the metrics.",
    "Every step must be executable HERE: a Codex agent with web access + local CPU/GPU + PUBLIC data/code,",
    "with NO paid LLM API keys and NO proprietary data. If the most ambitious version is not feasible here,",
    "scope DOWN to what is genuinely runnable — but keep it rigorous (real data, seeds, ablations, statistics).",
    "Do NOT propose a toy or a single one-shot run.",
    "Ground the plan in the source paper: relationToSourcePaper must explain how this work extends it,",
    "and citations MUST include the source paper as sourceType \"paper\" with its exact url and sourceId.",
    ...buildPriorFeedbackSection(input.feedback),
    "Claimed job input:",
    JSON.stringify(input, null, 2)
  ].join("\n");
}
```

- [ ] **Step 5: Run the worker tests and watch them pass**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: PASS (the new plan test + all existing tests). If any existing plan-prompt assertion referenced "smallest credible", update it to the new content.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).
```bash
git add scripts/researchfinder-worker.ts tests/researchfinder-worker.test.ts
git commit -m "feat: rigorous plan prompt (real data, seeds, ablations, stats) + feedback injection (Phase 3)"
```

---

## Task 3: experiment prompt overhaul (the toy-data fix)

**Files:**
- Modify: `scripts/researchfinder-worker.ts` (`buildExperimentPrompt`)
- Modify: `tests/researchfinder-worker.test.ts` (update the existing experiment assertion + add feedback/real-data assertions)

- [ ] **Step 1: Update the existing experiment-prompt assertion to the new content (failing)**

In `tests/researchfinder-worker.test.ts`, the experiment-job test currently asserts (around line 800):

```ts
    expect(promptText).toContain(
      "You are running a real, minimal research experiment in your current working directory."
    );
```

Replace that assertion block with assertions for the new prompt, and add a feedback assertion (set `input.feedback` on the claimed experiment job in that test — add `feedback: "Prior critic: use the full dataset, not a subset."` to the job's `input`):

```ts
    expect(promptText).not.toContain("minimal research experiment");
    expect(promptText).not.toContain("smallest credible experiment");
    expect(promptText).toContain("INPUT.json");
    expect(promptText.toLowerCase()).toContain("real data");
    expect(promptText.toLowerCase()).toContain("never fabricate");
    expect(promptText).toContain("Prior critic: use the full dataset, not a subset.");
```

> Keep the `"INPUT.json"` assertion — the new prompt still references it. Find where this test builds the claimed experiment job's `input` and add the `feedback` field there.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: FAIL — old "minimal research experiment" string gone-check fails (it's still there), and the real-data/feedback strings are absent.

- [ ] **Step 3: Overhaul `buildExperimentPrompt`**

Replace `buildExperimentPrompt` with:

```ts
function buildExperimentPrompt(input: ExperimentJobInput) {
  return [
    "You are running a REAL, COMPLETE research experiment in your current working directory.",
    "The full task input (idea, source paper, approved plan, literature positioning/gaps) is in INPUT.json in this directory — read it first.",
    "Obtain the REAL data the plan names: download it or build it from real public sources, and record its",
    "provenance (source URLs + how you obtained it). Then implement the method and ACTUALLY RUN THE FULL STUDY —",
    "all planned conditions, datasets, and baselines, with MULTIPLE seeds/repetitions. Save raw outputs and",
    "artifacts to disk. Take as long as you need: there is no time limit, and thoroughness matters more than speed.",
    "NEVER fabricate, synthesize, or stub the data, and never create toy/'_micro'/'_style'/dummy fixtures.",
    "If you genuinely cannot obtain a required dataset or run a condition, say so honestly in limitations and",
    "report verdict \"partial\" or \"failed\" — do NOT invent stand-in data to appear complete.",
    "When finished, output ONLY valid JSON matching the ExperimentResult schema as your final message. Do not wrap it in Markdown.",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    "Required keys: researchProjectId, relationToSourcePaper, implementationSummary, environment,",
    "hypothesisOutcomes (>=1, each {hypothesis, outcome: supported|refuted|inconclusive, evidence}),",
    "metrics (each {name, value, unit?, baseline?}), findings (>=1), limitations,",
    "artifacts (each {path, description?, bytes}), logsExcerpt, reproductionSteps (>=1),",
    "verdict (success|partial|failed), summary, citations (>=1).",
    "Ground in the source paper: relationToSourcePaper must explain how this work extends it,",
    'and citations MUST include the source paper as sourceType "paper" with its exact url and sourceId.',
    ...buildPriorFeedbackSection(input.feedback)
  ].join("\n");
}
```

- [ ] **Step 4: Run the worker tests and watch them pass**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).
```bash
git add scripts/researchfinder-worker.ts tests/researchfinder-worker.test.ts
git commit -m "feat: experiment prompt demands real data + full study, forbids fabrication (Phase 3)"
```

---

## Task 4: analysis prompt overhaul (rigorous statistics)

**Files:**
- Modify: `scripts/researchfinder-worker.ts` (`buildAnalysisPrompt`)
- Modify: `tests/researchfinder-worker.test.ts`

- [ ] **Step 1: Extend the analysis-prompt test (failing)**

In `tests/researchfinder-worker.test.ts`, the analysis-job test asserts `promptText` contains `"INPUT.json"` and `"analysis/"` (around line 913). Add assertions for the new rigor language + feedback (add `feedback: "Prior critic: report confidence intervals."` to that test's claimed analysis job `input`):

```ts
    expect(promptText).toContain("INPUT.json");
    expect(promptText).toContain("analysis/");
    expect(promptText.toLowerCase()).toContain("confidence interval");
    expect(promptText.toLowerCase()).toContain("effect size");
    expect(promptText).toContain("Prior critic: report confidence intervals.");
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: FAIL — "confidence interval"/"effect size"/feedback absent.

- [ ] **Step 3: Overhaul `buildAnalysisPrompt`**

Replace `buildAnalysisPrompt` with:

```ts
function buildAnalysisPrompt(input: AnalysisJobInput) {
  return [
    "You are analyzing the results of a completed research experiment in your current working directory.",
    "The experiment's raw outputs (code, data, logs, artifacts) are in the experiment/ subdirectory.",
    "The full task input (idea, source paper, plan success criteria, literature positioning, and the",
    "experiment's reported results) is in analysis/INPUT.json — read it first.",
    "Do RIGOROUS statistics on the experiment's RAW outputs: report significance tests, effect sizes,",
    "confidence intervals, and multiple-comparison corrections appropriate to the design, plus robustness",
    "checks. Do not report bare means. Judge the results HONESTLY against the plan's successCriteria, and",
    "generate publication-quality figures and tables.",
    "Write every figure/table/data file you produce into the analysis/ subdirectory.",
    "When finished, output ONLY valid JSON matching the AnalysisResult schema as your final message. Do not wrap it in Markdown.",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    "Required keys: researchProjectId, relationToSourcePaper,",
    "successCriteriaAssessment (>=1, each {criterion, status: met|partially_met|not_met|inconclusive, evidence}),",
    "statisticalFindings (each {description, method?, value?, interpretation}), keyFindings (>=1),",
    "artifacts (each {path, caption, kind: figure|table|data, bytes}) referencing the files you wrote under analysis/,",
    "comparisonToBaselines, threatsToValidity, recommendedNextSteps,",
    "verdict (supports_hypotheses|mixed|refutes_hypotheses|inconclusive), summary, citations (>=1).",
    "Ground in the source paper: relationToSourcePaper must explain how this analysis relates to it,",
    'and citations MUST include the source paper as sourceType "paper" with its exact url and sourceId.',
    ...buildPriorFeedbackSection(input.feedback)
  ].join("\n");
}
```

- [ ] **Step 4: Run + typecheck + commit**

Run: `npx vitest run tests/researchfinder-worker.test.ts` (expect PASS); `npx tsc --noEmit` (expect clean).
```bash
git add scripts/researchfinder-worker.ts tests/researchfinder-worker.test.ts
git commit -m "feat: analysis prompt demands rigorous statistics + feedback injection (Phase 3)"
```

---

## Task 5: literature `availableResources` field + prompt overhaul

**Files:**
- Modify: `src/lib/v2/schemas.ts` (`LiteratureReviewSchema`)
- Modify: `scripts/researchfinder-worker.ts` (`buildLiteraturePrompt`)
- Modify: `tests/research-schemas.test.ts`
- Modify: `tests/researchfinder-worker.test.ts`

- [ ] **Step 1: Write the failing schema test**

In `tests/research-schemas.test.ts`, find the `describe("LiteratureReviewSchema", …)` block (it has a `valid` fixture). Add:

```ts
  it("accepts an optional availableResources inventory", () => {
    expect(
      LiteratureReviewSchema.parse({ ...valid, availableResources: ["CIFAR-10 (public)", "timm (GitHub)"] }).availableResources
    ).toEqual(["CIFAR-10 (public)", "timm (GitHub)"]);
    // still valid without it (optional)
    expect(LiteratureReviewSchema.parse(valid).availableResources).toBeUndefined();
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/research-schemas.test.ts`
Expected: FAIL — `availableResources` is an unknown key under `strictObject`.

- [ ] **Step 3: Add the field to `LiteratureReviewSchema`**

In `src/lib/v2/schemas.ts`, in `LiteratureReviewSchema`, add the field before `citations`:

```ts
  positioning: CoercibleString,
  availableResources: z.array(CoercibleString).optional(),
  citations: z.array(CitationSchema).min(1)
});
```

> Optional (not `.min(1)`) so existing literature artifacts/fixtures without it still validate; the Phase-2 literature critic enforces that resources are actually surfaced.

- [ ] **Step 4: Run the schema test and watch it pass**

Run: `npx vitest run tests/research-schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the literature-prompt worker test (failing)**

In `tests/researchfinder-worker.test.ts`, the literature-job test captures `promptText`. Add assertions for the new content + feedback (add `feedback: "Prior critic: verify every citation URL."` to that test's claimed literature job `input`):

```ts
    expect(promptText.toLowerCase()).toContain("availableresources");
    expect(promptText.toLowerCase()).toContain("never invent");
    expect(promptText).toContain("Prior critic: verify every citation URL.");
```

> If the existing literature test asserts the old first line ("You are writing a focused literature review…"), update it to the new first line below.

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run tests/researchfinder-worker.test.ts`
Expected: FAIL — new strings absent.

- [ ] **Step 7: Overhaul `buildLiteraturePrompt`**

Replace `buildLiteraturePrompt` with:

```ts
function buildLiteraturePrompt(input: LiteratureJobInput, evidenceBundle: Record<string, unknown>) {
  return [
    "You are writing a RIGOROUS, VERIFIABLE literature review for a viability-checked research project.",
    "Return only valid JSON matching the LiteratureReview schema exactly. Do not wrap it in Markdown.",
    `The JSON researchProjectId must be exactly ${JSON.stringify(input.researchProjectId)}.`,
    "Required keys: researchProjectId, relationToSourcePaper, relatedWorks (>=1, each with",
    "title/summary/relationToProposed), themes (>=1), gaps (>=1), positioning, availableResources, citations (>=1).",
    "Cite REAL retrieved works with resolvable URLs as sourceType \"related_work\" — never invent citations.",
    "Identify a concrete, genuinely-open gap (not a truism).",
    "availableResources: inventory the publicly available datasets/code/benchmarks relevant to this direction",
    "(these feed experiment feasibility) — name each with how to obtain it.",
    "Ground in the source paper: relationToSourcePaper must explain how this work extends it,",
    "and citations MUST include the source paper as sourceType \"paper\" with its exact url and sourceId.",
    "If evidence is empty, still synthesize from the plan and the source paper.",
    ...buildPriorFeedbackSection(input.feedback),
    "Claimed job input (idea, source paper, and the approved plan):",
    JSON.stringify(input, null, 2),
    "",
    "Retrieved related-work evidence:",
    JSON.stringify(evidenceBundle, null, 2)
  ].join("\n");
}
```

- [ ] **Step 8: Run + typecheck + commit**

Run: `npx vitest run tests/researchfinder-worker.test.ts` and `npx vitest run tests/research-schemas.test.ts` (expect PASS); `npx tsc --noEmit` (expect clean).
```bash
git add src/lib/v2/schemas.ts scripts/researchfinder-worker.ts tests/research-schemas.test.ts tests/researchfinder-worker.test.ts
git commit -m "feat: literature prompt demands verifiable sources + resources inventory; add availableResources (Phase 3)"
```

---

## Task 6: final verification

No code. Verify the phase is green and typechecks.

- [ ] **Step 1: Fast suites**

Run:
```bash
npx vitest run tests/research-schemas.test.ts tests/researchfinder-worker.test.ts tests/critic-criteria.test.ts tests/critic-verdict-schema.test.ts tests/research-router.test.ts tests/research-stages.test.ts tests/worker-output-validation.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Postgres suites (serially)**

Run each on its own:
```bash
export TEST_DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/"//g; s/54329/5432/')
npx vitest run tests/research-worker-routes.test.ts --testTimeout=120000 --hookTimeout=120000
npx vitest run tests/research-lifecycle.test.ts --testTimeout=120000 --hookTimeout=120000
```
Expected: all PASS.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

---

## Spec coverage (self-review)

| Master-spec Phase 3 requirement | Task |
|---|---|
| Producer prompts demand real data / no fabrication (experiment) | 3 |
| Producer prompts demand rigor + feasibility (plan) | 2 |
| Analysis: rigorous statistics | 4 |
| Literature: verifiable sources + usable-resource inventory | 5 |
| Feedback carry — re-dispatched producer sees the prior critique | 1 (plumbing) + 2–5 (prompt injection) |
| `literature → plan` reorder | **DEFERRED** to a later phase (see scope note) |

**Out of scope for Phase 3 (deferred):**
- The `literature → plan` reorder (its own later phase): flips the first stage, swaps plan↔literature upstream wiring + input schemas, and updates the order-pinned tests + the plan/literature critic criteria. When it lands, the plan producer gains the literature artifact as input and its prompt should reference it.
- The paper stage → Phase 4; the observability dashboard → Phase 5.

## Traceability — exact names introduced

- `src/lib/v2/schemas.ts`: `feedback?` on `ResearchPlanJobInputSchema`/`LiteratureJobInputSchema`/`ExperimentJobInputSchema`/`AnalysisJobInputSchema`; `availableResources?` on `LiteratureReviewSchema`
- `src/app/api/workers/claim/route.ts`: `feedback: job.feedback ?? undefined` in the 4 producer builders
- `scripts/researchfinder-worker.ts`: `buildPriorFeedbackSection(feedback?: string | null): string[]`, used by all 4 producer prompt builders; prompts overhauled (no "smallest"/"minimal")
