import { readFileSync } from "node:fs";
import { join } from "node:path";

type WorkerConfig = {
  appUrl: string;
  workerToken: string;
};

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function loadConfig(): WorkerConfig {
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

async function main() {
  const config = loadConfig();
  const response = await fetch(`${config.appUrl}/api/workers/claim`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.workerToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Worker claim failed with ${response.status}`);
  }

  const payload = (await response.json()) as { job: null | { id: string; type: string; input: unknown } };
  if (!payload.job) {
    console.log("No ResearchFinder worker job available");
    return;
  }

  console.log(`Claimed ${payload.job.type} job ${payload.job.id}`);
  throw new Error(`No local executor is registered for ${payload.job.type} in this worker slice`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
