import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { computeReconcilePlan } from "@/lib/launcher/reconcile";
import { type LauncherLane } from "@/lib/v2/domain";

type LauncherConfig = { appUrl: string; launcherToken: string; codexCommand?: string };
type WorkerHandle = { lane: LauncherLane; child: ChildProcess; isAlive: () => boolean };

type Options = {
  fetchImpl?: typeof fetch;
  spawnWorker?: (lane: LauncherLane, workerToken: string) => WorkerHandle;
  killWorker?: (handle: WorkerHandle) => void;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxIterations?: number;
  shouldStop?: () => boolean;
};

const DEFAULT_POLL_MS = 20_000;
const norm = (u: string) => u.replace(/\/+$/, "");

export async function runResearchFinderLauncher(config: LauncherConfig, options: Options = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const spawnWorker = options.spawnWorker ?? defaultSpawnWorker(config);
  const killWorker = options.killWorker ?? ((h: WorkerHandle) => h.child.kill());
  const running = new Map<LauncherLane, WorkerHandle>();
  let iterations = 0;

  while (!options.shouldStop?.()) {
    try {
      // prune dead children
      for (const [lane, h] of [...running]) if (!h.isAlive()) running.delete(lane);

      const stateRes = await doFetch(`${norm(config.appUrl)}/api/launcher/state`, {
        headers: { authorization: `Bearer ${config.launcherToken}` }
      });
      if (!stateRes.ok) throw new Error(`launcher state failed: ${stateRes.status}`);
      const desired = (await stateRes.json()) as { inbox: boolean; research: boolean };

      const plan = computeReconcilePlan(desired, [...running.keys()]);
      for (const lane of plan.toKill) {
        const h = running.get(lane);
        if (h) { killWorker(h); running.delete(lane); }
      }
      for (const lane of plan.toSpawn) {
        const tokenRes = await doFetch(`${norm(config.appUrl)}/api/launcher/workers/${lane}/token`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.launcherToken}` }
        });
        if (!tokenRes.ok) throw new Error(`token provision failed for ${lane}: ${tokenRes.status}`);
        const { token } = (await tokenRes.json()) as { token: string };
        running.set(lane, spawnWorker(lane, token));
      }
    } catch (error) {
      // Transient: log and keep running workers as-is (do not tear down on poll failure).
      console.error(error instanceof Error ? error.message : String(error));
    }

    iterations += 1;
    if (options.maxIterations !== undefined && iterations >= options.maxIterations) return;
    await sleep(pollMs);
  }
}

function defaultSpawnWorker(config: LauncherConfig) {
  return (lane: LauncherLane, workerToken: string): WorkerHandle => {
    const dir = mkdtempSync(join(tmpdir(), `rf-launcher-${lane}-`));
    const cfgPath = join(dir, ".worker.json");
    writeFileSync(cfgPath, JSON.stringify({ appUrl: config.appUrl, workerToken, codexCommand: config.codexCommand }), "utf8");
    const tsxPath = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const child = spawn(process.execPath, [tsxPath, "scripts/researchfinder-worker.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, RESEARCHFINDER_WORKER_CONFIG: cfgPath, RESEARCHFINDER_CODEX_COMMAND: config.codexCommand ?? "" },
      stdio: "inherit"
    });
    let alive = true;
    child.on("exit", () => { alive = false; });
    return { lane, child, isAlive: () => alive };
  };
}

export function loadLauncherConfig(): LauncherConfig {
  const path = process.env.RESEARCHFINDER_LAUNCHER_CONFIG ?? join(process.cwd(), ".launcher.json");
  return JSON.parse(readFileSync(path, "utf8")) as LauncherConfig;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResearchFinderLauncher(loadLauncherConfig()).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
