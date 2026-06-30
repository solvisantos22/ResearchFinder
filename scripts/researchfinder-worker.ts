import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { VIABILITY_VERDICTS } from "@/lib/v2/domain";
import {
  AnalysisJobInputSchema,
  ExperimentJobInputSchema,
  InboxGenerationJobInputSchema,
  LiteratureJobInputSchema,
  NoveltyScanJobInputSchema,
  PaperJobInputSchema,
  ResearchPlanJobInputSchema,
  type AnalysisJobInput,
  type ExperimentJobInput,
  type InboxGenerationJobInput,
  type LiteratureJobInput,
  type NoveltyScanJobInput,
  type PaperJobInput,
  type ResearchPlanJobInput
} from "@/lib/v2/schemas";
import { buildNoveltyQueries } from "@/lib/novelty/query-builder";
import {
  runCodex as defaultRunCodex,
  runCodexAgentic as defaultRunCodexAgentic
} from "@/worker/codex-runner";
import { gatherNoveltySourceEvidence as defaultGatherNoveltySourceEvidence } from "@/worker/novelty-sources";
import {
  parseCriticVerdict,
  parseInboxGenerationOutput,
  parseNoveltyScanOutput,
  parseResearchStageOutput,
  parseViabilityOutput
} from "@/worker/output-validation";

type WorkerConfig = {
  appUrl: string;
  workerToken: string;
  codexCommand?: string;
};

type Sleep = (ms: number) => Promise<void>;

type ClaimedWorkerJob = {
  id: string;
  type: string;
  input: unknown;
};

type WorkerRunOptions = {
  runCodex?: typeof defaultRunCodex;
  runCodexAgentic?: typeof defaultRunCodexAgentic;
  gatherNoveltySourceEvidence?: typeof defaultGatherNoveltySourceEvidence;
  sleep?: Sleep;
  pollMs?: number;
  maxIterations?: number;
  heartbeatMs?: number;
  shouldStop?: () => boolean;
};

type WorkerJobRunResult = {
  output: unknown;
  validationError?: unknown;
};

const DEFAULT_WORKER_POLL_MS = 30_000;

export class FatalWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalWorkerError";
  }
}

class ProcessedWorkerError extends Error {
  constructor(error: unknown) {
    super(formatErrorMessage(error));
    this.name = "ProcessedWorkerError";
  }
}

type ViabilityJobInput = {
  jobId: string;
  userId: string;
  sprintDepth: string;
  autonomyLevel: string;
  idea: {
    id: string;
    title: string;
    summary: string;
    details: string;
    smallestSprint: string;
  };
  paper: {
    id: string;
    title: string;
    abstract: string;
    url: string;
    authors: string[];
    categories: string[];
    publishedAt: string;
  };
  citations: Array<{
    sourceType: "paper" | "related_work" | "web" | "generated_analysis";
    title: string;
    url: string;
    sourceId?: string | null;
    claim: string;
    confidence: number;
  }>;
};

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function loadConfig(): WorkerConfig {
  const configPath = process.env.RESEARCHFINDER_WORKER_CONFIG ?? join(process.cwd(), ".worker.json");

  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as WorkerConfig;
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(
        `ResearchFinder worker config not found at ${configPath}. Create .worker.json or set RESEARCHFINDER_WORKER_CONFIG.`
      );
    }

    throw error;
  }
}

export async function runResearchFinderWorker(
  config: WorkerConfig = loadConfig(),
  options: WorkerRunOptions = {}
) {
  const sleep = options.sleep ?? sleepMs;
  const pollMs = resolvePollMs(options.pollMs);
  let iterations = 0;

  while (!options.shouldStop?.()) {
    let processed = false;

    try {
      processed = await runResearchFinderWorkerOnce(config, options);
    } catch (error) {
      if (error instanceof FatalWorkerError) {
        throw error;
      }

      processed = error instanceof ProcessedWorkerError;
      console.error(formatErrorMessage(error));
    }

    iterations += 1;
    if (options.maxIterations !== undefined && iterations >= options.maxIterations) {
      return;
    }

    if (!processed) {
      await sleep(pollMs);
    }
  }
}

export async function runResearchFinderWorkerOnce(
  config: WorkerConfig = loadConfig(),
  options: WorkerRunOptions = {}
) {
  validateWorkerConfig(config);

  const response = await fetch(`${normalizeAppUrl(config.appUrl)}/api/workers/claim`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.workerToken}`
    }
  });

  if (!response.ok) {
    throwWorkerHttpError(
      "claim",
      response.status,
      await buildWorkerHttpErrorMessage("claim", response)
    );
  }

  let rawPayload: unknown;
  try {
    rawPayload = await response.json();
  } catch (error) {
    throw new FatalWorkerError(
      `Worker claim response was not valid JSON: ${formatErrorMessage(error)}`
    );
  }

  const payload = parseClaimPayload(rawPayload);
  if (!payload.job) {
    console.log("No ResearchFinder worker job available");
    return false;
  }

  console.log(`Claimed ${payload.job.type} job ${payload.job.id}`);

  if (payload.job.type === "inbox_generation") {
    const result = await runInboxGenerationJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (payload.job.type === "novelty_scan") {
    const result = await runNoveltyScanJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (payload.job.type === "viability_check") {
    const result = await runViabilityJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (payload.job.type === "research_plan") {
    const result = await runResearchPlanJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (payload.job.type === "research_literature") {
    const result = await runLiteratureJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (payload.job.type === "research_experiment") {
    const result = await runExperimentJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (payload.job.type === "research_analysis") {
    const result = await runAnalysisJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (payload.job.type === "research_paper") {
    const result = await runPaperJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (
    payload.job.type === "research_plan_critic" ||
    payload.job.type === "research_literature_critic" ||
    payload.job.type === "research_experiment_critic" ||
    payload.job.type === "research_analysis_critic" ||
    payload.job.type === "research_paper_critic"
  ) {
    const result = await runStageCriticJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw new ProcessedWorkerError(result.validationError);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  throw new FatalWorkerError(
    `No local executor is registered for ${payload.job.type} in this worker slice`
  );
}

type WorkerHttpErrorClassification = "fatal" | "processed" | "transient";

function throwWorkerHttpError(
  stage: "claim" | "completion" | "heartbeat",
  status: number,
  message = `Worker ${stage} failed with ${status}`
): never {
  const classification = classifyWorkerHttpError(stage, status);

  if (classification === "fatal") {
    throw new FatalWorkerError(message);
  }

  if (classification === "processed") {
    throw new ProcessedWorkerError(new Error(message));
  }

  throw new Error(message);
}

function classifyWorkerHttpError(
  stage: "claim" | "completion" | "heartbeat",
  status: number
): WorkerHttpErrorClassification {
  if (status === 401 || status === 403) {
    return "fatal";
  }

  if (stage === "claim" || stage === "heartbeat") {
    if (status === 408 || status === 429) {
      return "transient";
    }

    return status < 500 ? "fatal" : "transient";
  }

  if (status === 400) {
    return "processed";
  }

  if (status === 404) {
    return "fatal";
  }

  if (status === 429 || status >= 500) {
    return "transient";
  }

  return "fatal";
}

async function buildWorkerHttpErrorMessage(
  stage: "claim" | "completion" | "heartbeat",
  response: Response
) {
  const baseMessage = `Worker ${stage} failed with ${response.status}`;
  const responseError = await readResponseError(response);
  return responseError ? `${baseMessage}: ${responseError}` : baseMessage;
}

async function readResponseError(response: Response) {
  try {
    const body = (await response.clone().json()) as unknown;
    if (isRecord(body) && typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error.trim();
    }
  } catch {
    return null;
  }

  return null;
}

function validateWorkerConfig(config: WorkerConfig) {
  if (!isRecord(config)) {
    throw new FatalWorkerError("ResearchFinder worker config must be an object");
  }

  if (typeof config.workerToken !== "string" || config.workerToken.trim().length === 0) {
    throw new FatalWorkerError("ResearchFinder worker token must be a non-empty string");
  }

  try {
    const url = new URL(config.appUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Expected HTTP(S) URL");
    }
  } catch {
    throw new FatalWorkerError("ResearchFinder worker appUrl must be an HTTP(S) URL");
  }
}

function parseClaimPayload(value: unknown): { job: null | ClaimedWorkerJob } {
  if (!isRecord(value) || !("job" in value)) {
    throw new FatalWorkerError("Worker claim response did not include a job field");
  }

  if (value.job === null) {
    return { job: null };
  }

  if (!isRecord(value.job)) {
    throw new FatalWorkerError("Worker claim response job must be an object or null");
  }

  const job = value.job;
  if (typeof job.id !== "string" || job.id.trim().length === 0) {
    throw new FatalWorkerError("Worker claim response job.id must be a non-empty string");
  }

  if (
    job.type !== "inbox_generation" &&
    job.type !== "novelty_scan" &&
    job.type !== "viability_check" &&
    job.type !== "research_plan" &&
    job.type !== "research_literature" &&
    job.type !== "research_experiment" &&
    job.type !== "research_analysis" &&
    job.type !== "research_plan_critic" &&
    job.type !== "research_literature_critic" &&
    job.type !== "research_experiment_critic" &&
    job.type !== "research_analysis_critic" &&
    job.type !== "research_paper" &&
    job.type !== "research_paper_critic"
  ) {
    throw new FatalWorkerError(`Unsupported worker job type: ${String(job.type)}`);
  }

  if (!("input" in job)) {
    throw new FatalWorkerError("Worker claim response job.input is missing");
  }

  return {
    job: {
      id: job.id,
      type: job.type,
      input: job.input
    }
  };
}

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolvePollMs(explicitPollMs?: number) {
  if (isPositiveFiniteNumber(explicitPollMs)) {
    return explicitPollMs;
  }

  const configured = Number.parseInt(process.env.RESEARCHFINDER_WORKER_POLL_MS ?? "", 10);
  return isPositiveFiniteNumber(configured) ? configured : DEFAULT_WORKER_POLL_MS;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeAppUrl(appUrl: string) {
  return appUrl.replace(/\/+$/, "");
}

async function runInboxGenerationJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseInboxGenerationJobInput(job.input);
  const prompt = await writeInboxGenerationPrompt(job.id, input);

  try {
    let rawOutput: string;
    try {
      rawOutput = await (options.runCodex ?? defaultRunCodex)(prompt.file, {
        codexCommand: config.codexCommand
      });
    } catch (error) {
      await failWorkerJob(config, job, error);
      throw new ProcessedWorkerError(error);
    }

    try {
      return { output: parseInboxGenerationOutput(rawOutput) };
    } catch (error) {
      return {
        output: parseRawCodexOutputForCompletion(rawOutput),
        validationError: error
      };
    }
  } finally {
    await rm(prompt.dir, { force: true, recursive: true });
  }
}

async function runViabilityJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseViabilityJobInputForRun(job.input);
  const prompt = await writeViabilityPrompt(job.id, input);

  try {
    let rawOutput: string;
    try {
      rawOutput = await (options.runCodex ?? defaultRunCodex)(prompt.file, {
        codexCommand: config.codexCommand
      });
    } catch (error) {
      await failWorkerJob(config, job, error);
      throw new ProcessedWorkerError(error);
    }

    try {
      return { output: parseViabilityOutput(rawOutput) };
    } catch (error) {
      return {
        output: parseRawCodexOutputForCompletion(rawOutput),
        validationError: error
      };
    }
  } finally {
    await rm(prompt.dir, { force: true, recursive: true });
  }
}

function sourcePaperRefFromInput(paper: {
  id: string;
  arxivId: string;
  url: string;
  title: string;
}) {
  return { id: paper.id, arxivId: paper.arxivId, url: paper.url, title: paper.title };
}

async function runResearchPlanJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseResearchPlanJobInput(job.input);
  const prompt = await writeResearchPlanPrompt(job.id, input);

  try {
    let rawOutput: string;
    try {
      rawOutput = await (options.runCodex ?? defaultRunCodex)(prompt.file, {
        codexCommand: config.codexCommand
      });
    } catch (error) {
      await failWorkerJob(config, job, error);
      throw new ProcessedWorkerError(error);
    }

    try {
      return {
        output: parseResearchStageOutput("plan", rawOutput, sourcePaperRefFromInput(input.paper))
      };
    } catch (error) {
      return {
        output: parseRawCodexOutputForCompletion(rawOutput),
        validationError: error
      };
    }
  } finally {
    await rm(prompt.dir, { force: true, recursive: true });
  }
}

function parseResearchPlanJobInput(value: unknown) {
  try {
    return ResearchPlanJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(
      `Research plan job input failed validation: ${formatErrorMessage(error)}`
    );
  }
}

async function writeResearchPlanPrompt(jobId: string, input: ResearchPlanJobInput) {
  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-research-plan-"));
  const promptFile = join(promptDir, `${jobId}.prompt.md`);
  await writeFile(promptFile, buildResearchPlanPrompt(input), "utf8");
  return { dir: promptDir, file: promptFile };
}

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

export function buildResearchPlanPrompt(input: ResearchPlanJobInput) {
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
    "- Specify a valid-comparison / internal-validity protocol to run BEFORE the full run, matched to the contribution type (these are examples, not the only allowed kinds). For a new benchmark or prompt manipulation: (1) gold-answer preservation across control/conflict surfaces; (2) conflict-surface lure salience; (3) control-surface absence of the same lure cue; (4) answer-label and lure-label balance within each family; (5) at least one representative item-pair table per family for audit. For a method/model/algorithm contribution: matched training data, compute, and hyperparameter-tuning budget across all arms; no train/test or pretraining leakage into the evaluation; baselines configured to reproduce their known published numbers; and ablations that isolate the specific mechanism the gain is attributed to. For any other contribution type (e.g. a theory, probing, interpretability, observational, data/corpus, or systems/efficiency study), specify the equivalent confound controls for its central comparison.",
    "- Specify concrete baselines, MULTIPLE seeds/repetitions, ablations, and an interpretability/competence floor (see below).",
    "- Include a concrete statistical-analysis plan: the primary estimand, unit of analysis, dependency structure (item/model/seed/family), effect sizes, confidence intervals, multiple-comparison handling, a power/MDE analysis, and a confirmatory hierarchical/clustered model for within-item paired designs.",
    "- successCriteria must be quantitative, decidable thresholds tied to the metrics — not only a headline effect threshold. For a benchmark/dataset contribution include manipulation-validity and task-competence thresholds; for a method/model/algorithm contribution include the fair-comparison conditions and the baseline numbers the method must beat.",
    "Every step must be executable HERE: a Codex agent with web access + local CPU/GPU + PUBLIC data/code,",
    "with NO paid LLM API keys and NO proprietary data. If the most ambitious version is not feasible here,",
    "scope DOWN to what is genuinely runnable — but keep it rigorous (real data, seeds, ablations, statistics).",
    "Scope DOWN if needed but keep an interpretability/competence floor matched to the contribution: for a",
    "benchmark, on control surfaces the evaluated model set (or a declared anchor model) must exceed BOTH",
    "random-choice and majority-class baselines by a preregistered margin in each analyzable family; for a",
    "method/model, the baseline arms must reproduce their known performance (not be crippled) so any gain is",
    "real. If the floor fails, the study may report a construction or feasibility result, but must NOT interpret",
    "the headline effect as the claimed finding.",
    "Do NOT propose a toy or a single one-shot run.",
    "Ground the plan in the source paper: relationToSourcePaper must explain how this work extends it,",
    "and citations MUST include the source paper as sourceType \"paper\" with its exact url and sourceId.",
    ...buildPriorFeedbackSection(input.feedback),
    "Claimed job input:",
    JSON.stringify(input, null, 2)
  ].join("\n");
}

async function runLiteratureJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseLiteratureJobInput(job.input);
  const gather = options.gatherNoveltySourceEvidence ?? defaultGatherNoveltySourceEvidence;

  const queries = buildNoveltyQueries({
    ideaTitle: input.idea.title,
    ideaSummary: input.idea.summary,
    paperTitle: input.paper.title,
    paperAbstract: input.paper.abstract,
    keywords: input.plan.hypotheses
  });
  const evidence = await gather({ queries, maxResultsPerQuery: 5 });

  const prompt = await writeLiteraturePrompt(job.id, input, { queries, ...evidence });

  try {
    let rawOutput: string;
    try {
      rawOutput = await (options.runCodex ?? defaultRunCodex)(prompt.file, {
        codexCommand: config.codexCommand
      });
    } catch (error) {
      await failWorkerJob(config, job, error);
      throw new ProcessedWorkerError(error);
    }

    try {
      return {
        output: parseResearchStageOutput("literature", rawOutput, sourcePaperRefFromInput(input.paper))
      };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    await rm(prompt.dir, { force: true, recursive: true });
  }
}

function parseLiteratureJobInput(value: unknown) {
  try {
    return LiteratureJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(`Literature job input failed validation: ${formatErrorMessage(error)}`);
  }
}

const DEFAULT_HEARTBEAT_MS = 60_000;

function parseExperimentJobInput(value: unknown) {
  try {
    return ExperimentJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(`Experiment job input failed validation: ${formatErrorMessage(error)}`);
  }
}

function experimentWorkspaceDir(researchProjectId: string) {
  const root =
    process.env.RESEARCHFINDER_EXPERIMENT_WORKSPACE_ROOT ??
    join(process.cwd(), ".research-workspaces");
  return join(root, researchProjectId, "experiment");
}

export function buildExperimentPrompt(input: ExperimentJobInput) {
  return [
    "You are running a REAL, COMPLETE research experiment in your current working directory.",
    "The full task input (idea, source paper, approved plan, literature positioning/gaps) is in INPUT.json in this directory — read it first.",
    "Obtain the REAL data the plan names: download it or build it from real public sources, and record its",
    "provenance (source URLs + how you obtained it).",
    "Establish a VALID COMPARISON before scaling up, matched to your contribution type:",
    "- If you build or transform benchmark items, FIRST produce benchmark_validation.jsonl with one row per item:",
    "  source_id, family, control_surface, conflict_surface, gold_answer, lure_answer, gold_label, lure_label,",
    "  semantic_equivalence_check, lure_salience_check, control_lure_absence_check, label_balance_group, and",
    "  validation_rationale. Do NOT run the full model grid until this validation artifact exists; if fewer than",
    "  95% of items in any family pass the semantic-equivalence and lure-salience checks, report honestly that the",
    "  benchmark manipulation failed rather than treating the study as complete.",
    "- If your contribution is a method/model/algorithm, FIRST establish the comparison's validity: match training",
    "  data, compute, and hyperparameter-tuning budget across ALL arms; verify there is no train/test or pretraining",
    "  leakage into the evaluation; confirm each baseline reproduces its known published numbers; and include",
    "  ablations that isolate the claimed mechanism. Save this comparison-validity evidence to disk before scaling up.",
    "- For any other contribution type, establish and save the equivalent comparison-validity evidence for its",
    "  central comparison before scaling up. The two cases above are examples, not the only allowed kinds.",
    "Then implement the method and ACTUALLY RUN THE FULL STUDY —",
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

async function runExperimentJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseExperimentJobInput(job.input);
  const workspaceDir = experimentWorkspaceDir(input.researchProjectId);
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(join(workspaceDir, "INPUT.json"), JSON.stringify(input, null, 2), "utf8");

  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-experiment-"));
  const promptFile = join(promptDir, `${job.id}.prompt.md`);
  await writeFile(promptFile, buildExperimentPrompt(input), "utf8");

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
        workspaceDir,
        codexCommand: config.codexCommand,
        signal: controller.signal
      });
    } catch (error) {
      const message = controller.signal.aborted
        ? "Experiment aborted by user"
        : formatErrorMessage(error);
      await failWorkerJob(config, job, new Error(message));
      throw new ProcessedWorkerError(error);
    }

    try {
      return {
        output: parseResearchStageOutput("experiment", rawOutput, sourcePaperRefFromInput(input.paper))
      };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    clearInterval(heartbeat);
    await rm(promptDir, { force: true, recursive: true });
  }
}

function analysisWorkspaceDirs(researchProjectId: string) {
  const root =
    process.env.RESEARCHFINDER_EXPERIMENT_WORKSPACE_ROOT ??
    join(process.cwd(), ".research-workspaces");
  const projectRoot = join(root, researchProjectId);
  return { projectRoot, analysisDir: join(projectRoot, "analysis") };
}

function parseAnalysisJobInput(value: unknown) {
  try {
    return AnalysisJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(`Analysis job input failed validation: ${formatErrorMessage(error)}`);
  }
}

export function buildAnalysisPrompt(input: AnalysisJobInput) {
  return [
    "You are analyzing the results of a completed research experiment in your current working directory.",
    "The experiment's raw outputs (code, data, logs, artifacts) are in the experiment/ subdirectory.",
    "The full task input (idea, source paper, plan success criteria, literature positioning, and the",
    "experiment's reported results) is in analysis/INPUT.json — read it first.",
    "FIRST validate measurement, matched to the contribution type:",
    "- For a scored/parsed benchmark: audit the parser/scorer against the raw generations — report parse-method",
    "  counts, invalid/unmatched outputs, changed labels vs upstream scoring, and an independent adjudication",
    "  sample stratified across gold-correct, lure-error, non-lure-wrong, unmatched-text, and parser-changed rows.",
    "- For a method/model contribution: confirm the metric is computed on the correct, uncontaminated split with",
    "  the right denominator and protocol and no metric leakage; report it across MULTIPLE seeds/runs with variance.",
    "- For any other contribution type, validate that the primary measurement actually measures the construct it",
    "  claims. The two cases above are examples, not the only allowed kinds.",
    "THEN do RIGOROUS, DESIGN-FAITHFUL statistics on the RAW outputs: significance tests, effect sizes,",
    "confidence intervals, and multiple-comparison corrections appropriate to the design, plus robustness",
    "checks and a power/MDE or sample-size sensitivity analysis. Identify the primary estimand and handle",
    "item/model/seed/family dependence (e.g. a hierarchical or clustered/GEE model with item clustering); do",
    "not report bare means. Report any claimed effect as an EXCESS over the appropriate base rate: for lure-error",
    "claims, explicitly test whether lure selection EXCEEDS matched-control and chance wrong-answer base rates,",
    "and flag binary/two-choice settings where 'lure among incorrect' is mechanically 'wrong answer' — do not call",
    "those strategy-misselection; for a method gain, the improvement must EXCEED seed-to-seed variance against a",
    "competently-tuned baseline, not a single lucky run. Judge the results HONESTLY against",
    "the plan's successCriteria, and generate publication-quality figures and tables.",
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

async function runAnalysisJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseAnalysisJobInput(job.input);
  const { projectRoot, analysisDir } = analysisWorkspaceDirs(input.researchProjectId);
  await mkdir(analysisDir, { recursive: true });
  await writeFile(join(analysisDir, "INPUT.json"), JSON.stringify(input, null, 2), "utf8");

  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-analysis-"));
  const promptFile = join(promptDir, `${job.id}.prompt.md`);
  await writeFile(promptFile, buildAnalysisPrompt(input), "utf8");

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
      const message = controller.signal.aborted
        ? "Analysis aborted by user"
        : formatErrorMessage(error);
      await failWorkerJob(config, job, new Error(message));
      throw new ProcessedWorkerError(error);
    }

    try {
      return {
        output: parseResearchStageOutput("analysis", rawOutput, sourcePaperRefFromInput(input.paper))
      };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    clearInterval(heartbeat);
    await rm(promptDir, { force: true, recursive: true });
  }
}

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

export function buildPaperPrompt(input: PaperJobInput) {
  return [
    "You are assembling a COMPLETE, submittable academic paper in your current working directory.",
    "The experiment and analysis raw outputs are in the experiment/ and analysis/ subdirectories",
    "(figures and tables the analysis produced are under analysis/). The full task input (idea, source",
    "paper, plan, literature, experiment + analysis results) is in paper/INPUT.json — read it first.",
    "Write the paper as LaTeX to paper/main.tex with the standard structure: Title, Abstract, Introduction,",
    "Related Work, Method, Experiments, Results, Discussion, Limitations, Conclusion, References.",
    "Include an artifact/release card stating exactly what is released and how to reproduce the headline numbers.",
    "For a benchmark or diagnostic contribution, ALSO include: (1) a table with at least one representative",
    "control/conflict item pair per family, including gold and lure; (2) a qualitative error table with real",
    "model outputs for correct, lure-error, non-lure-wrong, and parser-failure cases; (3) a benchmark-validation",
    "subsection summarizing semantic-equivalence, lure-salience, label-balance, and scoring-adjudication results.",
    "For a method/model/algorithm contribution, ALSO report: the exact training data, splits, compute budget, and",
    "full hyperparameters for every arm; evidence of no train/test leakage; baseline numbers shown to match known",
    "results; and the ablations isolating the claimed mechanism.",
    "For any other contribution type, ALSO include the equivalent reproducibility and validity evidence for its",
    "central claim (the two cases above are examples, not the only allowed kinds).",
    "Embed the analysis figures/tables (reference the files under analysis/) only after these auditability",
    "requirements are met. State the novel contribution explicitly relative to the source paper.",
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
      return {
        output: parseResearchStageOutput("paper", rawOutput, sourcePaperRefFromInput(input.paper))
      };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    clearInterval(heartbeat);
    await rm(promptDir, { force: true, recursive: true });
  }
}

type StageCriticJobInput = {
  researchProjectId: string;
  stageType: string;
  artifactToJudge: unknown;
  upstreamArtifacts: { stageType: string; artifact: unknown }[];
  sourcePaper: unknown;
  criteria: string;
};

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

function stageCriticWorkspaceDir(researchProjectId: string, stageType: string) {
  const root =
    process.env.RESEARCHFINDER_EXPERIMENT_WORKSPACE_ROOT ??
    join(process.cwd(), ".research-workspaces");
  return join(root, researchProjectId, `${stageType}-critic`);
}

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
    "The deliverable files referenced by ARTIFACT.json (its texPath/pdfPath and artifacts[].path —",
    "e.g. paper/main.tex, paper/main.pdf, and the analysis figures/tables) have been copied into this",
    "working directory at those same relative paths. Open and verify them directly (the PDF exists and",
    "is non-empty, figures/tables are present, byte counts match the artifact) rather than assuming absent.",
    upstreamLine
  ].join("\n");
}

// Keys whose string values point at a producer's on-disk deliverable file.
const ARTIFACT_PATH_KEYS = new Set(["path", "texPath", "pdfPath"]);

// A stage critic judges ARTIFACT.json from inside its own `<stage>-critic` workspace, but
// the artifact references deliverables (main.tex, main.pdf, figures, tables) by
// PROJECT-ROOT-relative paths (e.g. "paper/main.tex", "analysis/figure_1.png") that live
// in the sibling producer workspaces. Collect those referenced relative paths so we can
// stage them where the critic actually looks. Restricted to known path-bearing keys and
// to safe relative file paths (no absolute, no parent-dir traversal) so a stray string or
// a crafted path can't pull in unrelated files.
export function collectArtifactDeliverablePaths(artifact: unknown): string[] {
  const paths = new Set<string>();
  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string") {
      if (
        key !== undefined &&
        ARTIFACT_PATH_KEYS.has(key) &&
        value.length > 0 &&
        !value.startsWith("/") &&
        !value.split(/[\\/]/).includes("..") &&
        /\.\w+$/.test(value)
      ) {
        paths.add(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  visit(artifact);
  return [...paths];
}

// Copy the artifact's referenced deliverable files from the project workspace root (the
// parent of the critic workspace) into the critic workspace, mirroring their declared
// relative paths. This makes "paper/main.tex", "analysis/figure_1.png", etc. resolve from
// the critic's cwd so it can verify the compiled PDF, figures, and tables it was told
// exist. A referenced-but-absent source is skipped (the critic should still flag a
// genuinely missing deliverable). Returns the relative paths actually copied.
export async function provisionCriticDeliverables(
  criticWorkspaceDir: string,
  artifact: unknown
): Promise<string[]> {
  const projectRoot = dirname(criticWorkspaceDir);
  const copied: string[] = [];
  for (const rel of collectArtifactDeliverablePaths(artifact)) {
    const src = join(projectRoot, rel);
    const dest = join(criticWorkspaceDir, rel);
    try {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      copied.push(rel);
    } catch {
      // Source missing/unreadable — leave it absent so the critic judges honestly.
    }
  }
  return copied;
}

async function runStageCriticJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseStageCriticJobInput(job.input);
  const workspaceDir = stageCriticWorkspaceDir(input.researchProjectId, input.stageType);
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(join(workspaceDir, "ARTIFACT.json"), JSON.stringify(input.artifactToJudge, null, 2), "utf8");
  await writeFile(join(workspaceDir, "SOURCE.json"), JSON.stringify(input.sourcePaper, null, 2), "utf8");
  for (const upstream of input.upstreamArtifacts) {
    await writeFile(
      join(workspaceDir, `UPSTREAM_${upstream.stageType}.json`),
      JSON.stringify(upstream.artifact, null, 2),
      "utf8"
    );
  }
  // Stage the producer's referenced deliverables into the critic workspace so the
  // artifact's declared relative paths (paper/main.tex, analysis/figure_*.png, …)
  // resolve from the critic's cwd and it can verify the real files, not just the JSON.
  await provisionCriticDeliverables(workspaceDir, input.artifactToJudge);

  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-critic-"));
  const promptFile = join(promptDir, `${job.id}.prompt.md`);
  await writeFile(promptFile, buildStageCriticPrompt(input), "utf8");

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
        workspaceDir,
        codexCommand: config.codexCommand,
        signal: controller.signal
      });
    } catch (error) {
      const message = controller.signal.aborted ? "Critic aborted by user" : formatErrorMessage(error);
      await failWorkerJob(config, job, new Error(message));
      throw new ProcessedWorkerError(error);
    }

    try {
      return { output: parseCriticVerdict(rawOutput) };
    } catch (error) {
      return { output: parseRawCodexOutputForCompletion(rawOutput), validationError: error };
    }
  } finally {
    clearInterval(heartbeat);
    await rm(promptDir, { force: true, recursive: true });
  }
}

async function sendWorkerHeartbeat(
  config: WorkerConfig,
  jobId: string
): Promise<{ aborted: boolean } | null> {
  const response = await fetch(
    `${normalizeAppUrl(config.appUrl)}/api/workers/jobs/${encodeURIComponent(jobId)}/heartbeat`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.workerToken}` }
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throwWorkerHttpError("heartbeat", response.status, await buildWorkerHttpErrorMessage("heartbeat", response));
  }
  return (await response.json()) as { aborted: boolean };
}

async function writeLiteraturePrompt(
  jobId: string,
  input: LiteratureJobInput,
  evidenceBundle: Record<string, unknown>
) {
  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-literature-"));
  const promptFile = join(promptDir, `${jobId}.prompt.md`);
  await writeFile(promptFile, buildLiteraturePrompt(input, evidenceBundle), "utf8");
  return { dir: promptDir, file: promptFile };
}

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

async function runNoveltyScanJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<WorkerJobRunResult> {
  const input = parseNoveltyScanJobInput(job.input);
  const evidenceBundle = await gatherEvidenceForNoveltyInput(input, options);
  const prompt = await writeNoveltyScanPrompt(job.id, input, evidenceBundle);

  try {
    let rawOutput: string;
    try {
      rawOutput = await (options.runCodex ?? defaultRunCodex)(prompt.file, {
        codexCommand: config.codexCommand
      });
    } catch (error) {
      await failWorkerJob(config, job, error);
      throw new ProcessedWorkerError(error);
    }

    try {
      return {
        output: parseNoveltyScanOutput(rawOutput, {
          jobId: input.jobId,
          generatedForUserId: input.userId,
          inboxDate: input.inboxDate
        })
      };
    } catch (error) {
      return {
        output: parseRawCodexOutputForCompletion(rawOutput),
        validationError: error
      };
    }
  } finally {
    await rm(prompt.dir, { force: true, recursive: true });
  }
}

function parseNoveltyScanJobInput(value: unknown) {
  try {
    return NoveltyScanJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(
      `Novelty scan job input failed validation: ${formatErrorMessage(error)}`
    );
  }
}

async function gatherEvidenceForNoveltyInput(
  input: NoveltyScanJobInput,
  options: WorkerRunOptions
) {
  const gather = options.gatherNoveltySourceEvidence ?? defaultGatherNoveltySourceEvidence;
  const evidenceByIdeaId: Record<string, unknown> = {};

  for (const idea of input.ideas) {
    const queries = buildNoveltyQueries({
      ideaTitle: idea.title,
      ideaSummary: idea.summary,
      paperTitle: idea.paper.title,
      paperAbstract: idea.paper.abstract,
      keywords: input.profile.keywords
    });

    evidenceByIdeaId[idea.id] = {
      queries,
      ...(input.profile.allowRelatedWorkSearch
        ? await gather({ queries, maxResultsPerQuery: 3 })
        : {
            adaptersAttempted: [],
            adaptersFailed: [],
            evidence: []
          })
    };
  }

  return evidenceByIdeaId;
}

async function writeNoveltyScanPrompt(
  jobId: string,
  input: NoveltyScanJobInput,
  evidenceBundle: Record<string, unknown>
) {
  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-novelty-"));
  const promptFile = join(promptDir, `${jobId}.prompt.md`);

  await writeFile(promptFile, buildNoveltyScanPrompt(jobId, input, evidenceBundle), "utf8");
  return { dir: promptDir, file: promptFile };
}

function buildNoveltyScanPrompt(
  jobId: string,
  input: NoveltyScanJobInput,
  evidenceBundle: Record<string, unknown>
) {
  return [
    "You are running a bounded ResearchFinder daily novelty scan.",
    "Return only valid JSON. Do not wrap the result in Markdown.",
    "The JSON must match the NoveltyScanResult schema EXACTLY and use ONLY these keys:",
    '{ "generatedForUserId": <userId>, "inboxDate": <inboxDate>, "scans": [ {',
    '  "generatedIdeaId": <idea id>, "status": "completed"|"partial"|"failed",',
    '  "label": "likely_novel"|"unclear"|"crowded"|"near_duplicate"|"not_checked",',
    '  "confidence": <0..1>, "summary": <string>, "overlapExplanation": <string>,',
    '  "queries": [<string>], "adaptersAttempted": [<string>], "adaptersFailed": [<string>],',
    '  "evidence": [ { "sourceType": "arxiv"|"scholarly"|"web"|"github"|"generated_analysis",',
    '    "title": <string>, "url": <string or "">, "sourceId": <optional string>, "claim": <string>,',
    '    "overlapLevel": "exact"|"close"|"adjacent"|"weak", "confidence": <0..1> } ] } ] }',
    "Contract rules:",
    "- Return EXACTLY one scans entry per idea in the job input; generatedIdeaId must be that idea's id.",
    "- The array key is \"scans\". Do NOT use alternate keys such as 'results', 'status', or 'overallNotes'.",
    "- evidence is required (>=1) unless label is \"not_checked\".",
    "- every confidence is a number from 0 to 1; all string fields are plain strings, not arrays.",
    "Label guidance — do not force label variety; use the evidence:",
    "Use likely_novel only when the idea has a concrete differentiator and no close match.",
    "Use unclear when evidence is insufficient or adjacent overlap is unresolved.",
    "Use crowded when many adjacent sources exist.",
    "Use near_duplicate when a close paper, repo, benchmark, or project already does the same thing.",
    "Use not_checked only if evidence collection did not run.",
    `The worker pins jobId to ${JSON.stringify(jobId)}; you may omit it.`,
    "",
    "Claimed job input:",
    JSON.stringify(input, null, 2),
    "",
    "Source evidence gathered before synthesis:",
    JSON.stringify(evidenceBundle, null, 2)
  ].join("\n");
}

function parseInboxGenerationJobInput(value: unknown) {
  try {
    return InboxGenerationJobInputSchema.parse(value);
  } catch (error) {
    throw new FatalWorkerError(
      `Inbox generation job input failed validation: ${formatErrorMessage(error)}`
    );
  }
}

function parseRawCodexOutputForCompletion(rawOutput: string) {
  try {
    return JSON.parse(rawOutput) as unknown;
  } catch {
    return rawOutput;
  }
}

async function writeInboxGenerationPrompt(jobId: string, input: InboxGenerationJobInput) {
  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-inbox-"));
  const promptFile = join(promptDir, `${jobId}.prompt.md`);

  await writeFile(promptFile, buildInboxGenerationPrompt(input), "utf8");
  return { dir: promptDir, file: promptFile };
}

function buildInboxGenerationPrompt(input: InboxGenerationJobInput) {
  return [
    "You are generating a ResearchFinder v2 AI inbox from candidate arXiv papers.",
    "Return only valid JSON. Do not wrap the result in Markdown.",
    "The JSON must match the GeneratedInbox schema exactly and use only the keys in this contract:",
    buildGeneratedInboxJsonContract(),
    "Contract rules:",
    "- inboxDate: the claimed inbox date.",
    "- generatedForUserId: the claimed user id.",
    "- papers: one or more arXiv paper groups from candidatePapers only.",
    "- for each returned paper, copy sourceId, title, abstract, url, authors, categories, and publishedAt exactly from candidatePapers.",
    "- source must be exactly \"arxiv\" for every paper.",
    "- each idea must cite its source arXiv paper using sourceType \"paper\", matching sourceId and url.",
    "- every score must be a number from 0 to 1.",
    "- noveltyStatus should be \"not_checked\"; the separate morning novelty scan will calibrate it.",
    "- produce no more than profile.maxIdeas ideas total and no more than profile.maxIdeasPerPaper per paper.",
    "- Do not return alternate keys such as whyRelevant, feasibility, expectedOutput, or sources.",
    "Use the user's profile to choose relevant, feasible, original research directions.",
    "",
    "Claimed job input:",
    JSON.stringify(input, null, 2)
  ].join("\n");
}

function buildGeneratedInboxJsonContract() {
  return JSON.stringify(
    {
      inboxDate: "<copy input.inboxDate>",
      generatedForUserId: "<copy input.userId>",
      papers: [
        {
          source: "arxiv",
          sourceId: "<copy candidatePapers[n].sourceId>",
          title: "<copy candidatePapers[n].title>",
          abstract: "<copy candidatePapers[n].abstract>",
          url: "<copy candidatePapers[n].url>",
          authors: ["<copy candidatePapers[n].authors entries>"],
          categories: ["<copy candidatePapers[n].categories entries>"],
          publishedAt: "<copy candidatePapers[n].publishedAt>",
          whyPaperMatters: "<why this source paper is worth attention for the profile>",
          ideas: [
            {
              title: "<specific project idea title>",
              summary: "<brief summary>",
              expandedExplanation:
                "<substantial explanation of the idea, why it builds on the paper, and what would be built or studied>",
              trajectory:
                "<where the idea could go after a successful viability sprint, including possible paper direction>",
              recommended: true,
              noveltyStatus: "not_checked",
              scores: {
                relevance: 0.0,
                significance: 0.0,
                originality: 0.0,
                feasibility: 0.0,
                overall: 0.0
              },
              scoreExplanations: {
                relevance: "<why the relevance score was assigned>",
                significance: "<why the significance score was assigned>",
                originality: "<why the originality score was assigned>",
                feasibility: "<why the feasibility score was assigned>",
                overall: "<why the overall score was assigned>"
              },
              risks: ["<concrete risk or uncertainty>"],
              smallestViabilitySprint:
                "<smallest useful experiment or build sprint to check whether this idea is worth pursuing>",
              citations: [
                {
                  sourceType: "paper",
                  title: "<copy source paper title>",
                  url: "<copy source paper url>",
                  sourceId: "<copy source paper sourceId>",
                  claim: "<claim supported by the source paper>",
                  confidence: 0.0
                }
              ]
            }
          ]
        }
      ]
    },
    null,
    2
  );
}

function parseViabilityJobInputForRun(value: unknown) {
  try {
    return parseViabilityJobInput(value);
  } catch (error) {
    throw new FatalWorkerError(`Viability job input failed validation: ${formatErrorMessage(error)}`);
  }
}

async function writeViabilityPrompt(jobId: string, input: ViabilityJobInput) {
  const promptDir = await mkdtemp(join(tmpdir(), "researchfinder-viability-"));
  const promptFile = join(promptDir, `${jobId}.prompt.md`);

  await writeFile(promptFile, buildViabilityPrompt(jobId, input), "utf8");
  return { dir: promptDir, file: promptFile };
}

function buildViabilityPrompt(jobId: string, input: ViabilityJobInput) {
  return [
    "You are running a ResearchFinder v2 viability check for one AI-generated research idea.",
    "Return only valid JSON. Do not wrap the result in Markdown.",
    "The JSON must match the ViabilityResult schema exactly:",
    `- jobId: exactly ${JSON.stringify(jobId)}.`,
    `- verdict: one of ${VIABILITY_VERDICTS.join(", ")}.`,
    "- summary: concise viability assessment.",
    "- feasibility: concrete feasibility analysis for the requested sprint depth and autonomy level.",
    "- noveltyRisk: brief related-work and prior-art risk assessment.",
    "- minimumExperiment: the smallest credible experiment or build sprint.",
    "- blockers: array of concrete blockers, or an empty array if none are known.",
    "- citations: one or more citations grounding the analysis. Use sourceType paper for the source paper.",
    "Do not invent citations. Prefer the provided source paper and provided citations; use generated_analysis only for your own reasoning.",
    "",
    "Claimed job input:",
    JSON.stringify(input, null, 2)
  ].join("\n");
}

function parseViabilityJobInput(value: unknown): ViabilityJobInput {
  if (!isRecord(value)) {
    throw new Error("Viability job input must be an object");
  }

  const input = value as Partial<ViabilityJobInput>;
  if (!isRecord(input.idea) || !isRecord(input.paper)) {
    throw new Error("Viability job input is missing idea or paper context");
  }

  return {
    jobId: readString(input.jobId, "jobId"),
    userId: readString(input.userId, "userId"),
    sprintDepth: readString(input.sprintDepth, "sprintDepth"),
    autonomyLevel: readString(input.autonomyLevel, "autonomyLevel"),
    idea: {
      id: readString(input.idea.id, "idea.id"),
      title: readString(input.idea.title, "idea.title"),
      summary: readString(input.idea.summary, "idea.summary"),
      details: readString(input.idea.details, "idea.details"),
      smallestSprint: readString(input.idea.smallestSprint, "idea.smallestSprint")
    },
    paper: {
      id: readString(input.paper.id, "paper.id"),
      title: readString(input.paper.title, "paper.title"),
      abstract: readString(input.paper.abstract, "paper.abstract"),
      url: readString(input.paper.url, "paper.url"),
      authors: readStringArray(input.paper.authors, "paper.authors"),
      categories: readStringArray(input.paper.categories, "paper.categories"),
      publishedAt: readString(input.paper.publishedAt, "paper.publishedAt")
    },
    citations: Array.isArray(input.citations)
      ? input.citations.filter(isRecord).map((citation) => ({
          sourceType:
            citation.sourceType === "paper" ||
            citation.sourceType === "related_work" ||
            citation.sourceType === "web" ||
            citation.sourceType === "generated_analysis"
              ? citation.sourceType
              : "generated_analysis",
          title: readString(citation.title, "citation.title"),
          url: typeof citation.url === "string" ? citation.url : "",
          sourceId: typeof citation.sourceId === "string" ? citation.sourceId : undefined,
          claim: readString(citation.claim, "citation.claim"),
          confidence:
            typeof citation.confidence === "number" && Number.isFinite(citation.confidence)
              ? citation.confidence
              : 0.5
        }))
      : []
  };
}

async function completeWorkerJob(config: WorkerConfig, job: ClaimedWorkerJob, output: unknown) {
  const response = await fetch(
    `${normalizeAppUrl(config.appUrl)}/api/workers/jobs/${encodeURIComponent(job.id)}/complete`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.workerToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: job.type,
        output
      })
    }
  );

  if (!response.ok) {
    throwWorkerHttpError(
      "completion",
      response.status,
      await buildWorkerHttpErrorMessage("completion", response)
    );
  }
}

async function failWorkerJob(config: WorkerConfig, job: ClaimedWorkerJob, error: unknown) {
  const response = await fetch(
    `${normalizeAppUrl(config.appUrl)}/api/workers/jobs/${encodeURIComponent(job.id)}/complete`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.workerToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: job.type,
        error: formatErrorMessage(error)
      })
    }
  );

  if (!response.ok) {
    throwWorkerHttpError(
      "completion",
      response.status,
      await buildWorkerHttpErrorMessage("completion", response)
    );
  }
}

function readString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value;
}

function readStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must be an array of strings`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv.includes("--once")
    ? runResearchFinderWorkerOnce()
    : runResearchFinderWorker();

  command.catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
