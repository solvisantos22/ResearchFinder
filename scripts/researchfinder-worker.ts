import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { InboxGenerationJobInputSchema, type InboxGenerationJobInput } from "@/lib/v2/schemas";
import { runCodex as defaultRunCodex } from "@/worker/codex-runner";
import { parseInboxGenerationOutput, parseViabilityOutput } from "@/worker/output-validation";

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
  sleep?: Sleep;
  pollMs?: number;
  maxIterations?: number;
  shouldStop?: () => boolean;
};

type InboxGenerationRunResult = {
  output: unknown;
  validationError?: unknown;
};

const DEFAULT_WORKER_POLL_MS = 30_000;

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
  const response = await fetch(`${normalizeAppUrl(config.appUrl)}/api/workers/claim`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.workerToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Worker claim failed with ${response.status}`);
  }

  const payload = (await response.json()) as { job: null | ClaimedWorkerJob };
  if (!payload.job) {
    console.log("No ResearchFinder worker job available");
    return false;
  }

  console.log(`Claimed ${payload.job.type} job ${payload.job.id}`);

  if (payload.job.type === "viability_check") {
    const output = buildDeterministicViabilityOutput(payload.job);
    await completeWorkerJob(config, payload.job, output);
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  if (payload.job.type === "inbox_generation") {
    const result = await runInboxGenerationJob(payload.job, config, options);
    await completeWorkerJob(config, payload.job, result.output);
    if (result.validationError) throw result.validationError;
    console.log(`Completed ${payload.job.type} job ${payload.job.id}`);
    return true;
  }

  throw new Error(`No local executor is registered for ${payload.job.type} in this worker slice`);
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

function buildDeterministicViabilityOutput(job: ClaimedWorkerJob) {
  const input = parseViabilityJobInput(job.input);
  const citation = input.citations[0] ?? {
    sourceType: "paper" as const,
    title: input.paper.title,
    url: input.paper.url,
    sourceId: input.paper.id,
    claim: `The local worker used the claimed source paper "${input.paper.title}" as deterministic grounding for this placeholder viability result.`,
    confidence: 0.5
  };

  return parseViabilityOutput(
    JSON.stringify({
      jobId: job.id,
      verdict: "needs_novelty_check",
      summary:
        "Deterministic local worker result: this job was completed locally without a Codex executor, so it should be reviewed before expansion.",
      feasibility: `A bounded ${input.sprintDepth} sprint can start from: ${input.idea.smallestSprint}`,
      noveltyRisk:
        "Novelty was not independently checked by the local placeholder executor; run a focused related-work review before expansion.",
      minimumExperiment: input.idea.smallestSprint,
      blockers: [
        "This result was produced by the deterministic local worker fallback, not a deep AI viability analysis."
      ],
      citations: [citation]
    })
  );
}

async function runInboxGenerationJob(
  job: ClaimedWorkerJob,
  config: WorkerConfig,
  options: WorkerRunOptions
): Promise<InboxGenerationRunResult> {
  const input = InboxGenerationJobInputSchema.parse(job.input);
  const prompt = await writeInboxGenerationPrompt(job.id, input);

  try {
    const rawOutput = await (options.runCodex ?? defaultRunCodex)(prompt.file, {
      codexCommand: config.codexCommand
    });

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
    "The JSON must match the GeneratedInbox schema exactly:",
    "- inboxDate: the claimed inbox date.",
    "- generatedForUserId: the claimed user id.",
    "- papers: one or more arXiv paper groups from candidatePapers only.",
    "- each idea must cite its source arXiv paper using sourceType \"paper\", matching sourceId and url.",
    "- produce no more than profile.maxIdeas ideas total and no more than profile.maxIdeasPerPaper per paper.",
    "Use the user's profile to choose relevant, feasible, original research directions.",
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
    throw new Error(`Worker completion failed with ${response.status}`);
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
