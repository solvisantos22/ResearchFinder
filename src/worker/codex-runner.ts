import { spawn, type SpawnOptions } from "node:child_process";

type DataEmitter = {
  on(event: "data", listener: (chunk: unknown) => void): unknown;
};

type CodexChildProcess = {
  stdout: DataEmitter;
  stderr: DataEmitter;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
};

export type CodexSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions
) => CodexChildProcess;

type RunCodexOptions = {
  codexCommand?: string;
  platform?: NodeJS.Platform;
  spawn?: CodexSpawn;
};

export function buildCodexExecArgs(promptFile: string) {
  return ["exec", "--json", "--skip-git-repo-check", "--file", promptFile];
}

function quoteCmdPart(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function getDefaultCodexCommand(platform: NodeJS.Platform) {
  return platform === "win32" ? "codex.cmd" : "codex";
}

function shouldUseCmdShim(command: string, platform: NodeJS.Platform) {
  if (platform !== "win32") return false;

  const lowerCommand = command.toLowerCase();
  return (
    lowerCommand === "codex" ||
    lowerCommand.endsWith(".cmd") ||
    lowerCommand.endsWith(".bat")
  );
}

export function createCodexSpawnCommand(
  codexCommand: string,
  args: string[],
  platform: NodeJS.Platform
) {
  if (!shouldUseCmdShim(codexCommand, platform)) {
    return { command: codexCommand, args };
  }

  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", [codexCommand, ...args].map(quoteCmdPart).join(" ")]
  };
}

export async function runCodex(
  promptFile: string,
  options: RunCodexOptions = {}
): Promise<string> {
  const args = buildCodexExecArgs(promptFile);
  const platform = options.platform ?? process.platform;
  const commandPlan = createCodexSpawnCommand(
    options.codexCommand ?? getDefaultCodexCommand(platform),
    args,
    platform
  );
  const spawnCodex = options.spawn ?? (spawn as CodexSpawn);

  return new Promise((resolve, reject) => {
    const child = spawnCodex(commandPlan.command, commandPlan.args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`codex exited with ${code}: ${stderr}`));
    });
  });
}
