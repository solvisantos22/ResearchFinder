import { spawn, type SpawnOptions } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type DataEmitter = {
  on(event: "data", listener: (chunk: unknown) => void): unknown;
};

type CodexChildProcess = {
  stdin: {
    write(chunk: string): unknown;
    end(): unknown;
  };
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

type CodexSpawnCommand = {
  command: string;
  args: string[];
  options: SpawnOptions;
};

export function buildCodexExecArgs(outputFile: string) {
  return ["exec", "--json", "--skip-git-repo-check", "--output-last-message", outputFile, "-"];
}

function quoteCmdPart(value: string) {
  return `"${value.replaceAll("^", "^^").replaceAll("%", "^%").replaceAll("\"", "\"\"")}"`;
}

function wrapCmdPayload(value: string) {
  return `"${value}"`;
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
): CodexSpawnCommand {
  if (!shouldUseCmdShim(codexCommand, platform)) {
    return { command: codexCommand, args, options: {} };
  }

  const payload = [codexCommand, ...args].map(quoteCmdPart).join(" ");

  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", wrapCmdPayload(payload)],
    options: {
      windowsVerbatimArguments: true
    }
  };
}

export async function runCodex(
  promptFile: string,
  options: RunCodexOptions = {}
): Promise<string> {
  const prompt = await readFile(promptFile, "utf8");
  const outputDir = await mkdtemp(join(tmpdir(), "researchfinder-codex-"));
  const outputFile = join(outputDir, "last-message.txt");

  try {
    const args = buildCodexExecArgs(outputFile);
    const platform = options.platform ?? process.platform;
    const commandPlan = createCodexSpawnCommand(
      options.codexCommand ?? getDefaultCodexCommand(platform),
      args,
      platform
    );
    const spawnCodex = options.spawn ?? (spawn as CodexSpawn);

    await new Promise<void>((resolve, reject) => {
      const child = spawnCodex(commandPlan.command, commandPlan.args, {
        ...commandPlan.options,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stderr = "";

      child.stdout.on("data", () => {});

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`codex exited with ${code}: ${stderr}`));
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });

    return await readFile(outputFile, "utf8");
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}
