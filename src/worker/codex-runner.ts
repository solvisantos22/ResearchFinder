import { spawn } from "node:child_process";

export function buildCodexExecArgs(promptFile: string) {
  return ["exec", "--json", "--skip-git-repo-check", "--file", promptFile];
}

export async function runCodex(promptFile: string): Promise<string> {
  const args = buildCodexExecArgs(promptFile);

  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });
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
