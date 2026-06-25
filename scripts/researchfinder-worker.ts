import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { VIABILITY_VERDICTS } from "@/lib/v2/domain";
import {
  InboxGenerationJobInputSchema,
  NoveltyScanJobInputSchema,
  type InboxGenerationJobInput,
  type NoveltyScanJobInput
} from "@/lib/v2/schemas";
import { buildNoveltyQueries } from "@/lib/novelty/query-builder";
import { runCodex as defaultRunCodex } from "@/worker/codex-runner";
import { gatherNoveltySourceEvidence as defaultGatherNoveltySourceEvidence } from "@/worker/novelty-sources";
import {
  parseInboxGenerationOutput,
  parseNoveltyScanOutput,
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
  gatherNoveltySourceEvidence?: typeof defaultGatherNoveltySourceEvidence;
  sleep?: Sleep;
  pollMs?: number;
  maxIterations?: number;
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

  throw new FatalWorkerError(
    `No local executor is registered for ${payload.job.type} in this worker slice`
  );
}

type WorkerHttpErrorClassification = "fatal" | "processed" | "transient";

function throwWorkerHttpError(
  stage: "claim" | "completion",
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
  stage: "claim" | "completion",
  status: number
): WorkerHttpErrorClassification {
  if (status === 401 || status === 403) {
    return "fatal";
  }

  if (stage === "claim") {
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
  stage: "claim" | "completion",
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
    job.type !== "viability_check"
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
      return { output: parseNoveltyScanOutput(rawOutput) };
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
    "Do not force label variety. Use the evidence.",
    "Use likely_novel only when the idea has a concrete differentiator and no close match.",
    "Use unclear when evidence is insufficient or adjacent overlap is unresolved.",
    "Use crowded when many adjacent sources exist.",
    "Use near_duplicate when a close paper, repo, benchmark, or project already does the same thing.",
    "Use not_checked only if evidence collection did not run.",
    `The JSON jobId must be exactly ${JSON.stringify(jobId)}.`,
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
