import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCodexExecArgs, createCodexSpawnCommand, runCodex } from "@/worker/codex-runner";

const runOnWindows = process.platform === "win32" ? it : it.skip;

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  return child;
}

describe("codex runner", () => {
  it("builds codex exec arguments for json-only worker prompts", () => {
    expect(buildCodexExecArgs("prompt-file.md")).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--file",
      "prompt-file.md"
    ]);
  });

  it("keeps direct command invocation for non-Windows platforms", () => {
    expect(createCodexSpawnCommand("codex", ["exec"], "linux")).toEqual({
      command: "codex",
      args: ["exec"],
      options: {}
    });
  });

  it("wraps Windows cmd shims with cmd.exe while preserving arguments", () => {
    expect(
      createCodexSpawnCommand("C:\\Users\\Test User\\AppData\\Roaming\\npm\\codex.cmd", ["exec", "--file", "prompt file.md"], "win32")
    ).toEqual({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "\"\"C:\\Users\\Test User\\AppData\\Roaming\\npm\\codex.cmd\" \"exec\" \"--file\" \"prompt file.md\"\""
      ],
      options: {
        windowsVerbatimArguments: true
      }
    });
  });

  it("keeps direct Windows invocation for native exe commands", () => {
    expect(createCodexSpawnCommand("C:\\Tools\\codex.exe", ["exec"], "win32")).toEqual({
      command: "C:\\Tools\\codex.exe",
      args: ["exec"],
      options: {}
    });
  });

  it("resolves with stdout when codex exits successfully", async () => {
    const child = createMockChild();
    const output = runCodex("prompt-file.md", {
      codexCommand: "codex",
      platform: "linux",
      spawn: (command, args, options) => {
        expect(command).toBe("codex");
        expect(args).toEqual(buildCodexExecArgs("prompt-file.md"));
        expect(options).toEqual({ stdio: ["ignore", "pipe", "pipe"] });

        queueMicrotask(() => {
          child.stdout.emit("data", "json");
          child.stdout.emit("data", "-output");
          child.emit("close", 0);
        });

        return child;
      }
    });

    await expect(output).resolves.toBe("json-output");
  });

  it("uses the Windows cmd shim path by default on Windows", async () => {
    const child = createMockChild();
    const output = runCodex("prompt file.md", {
      platform: "win32",
      spawn: (command, args, options) => {
        expect(command).toBe("cmd.exe");
        expect(args).toEqual([
          "/d",
          "/s",
          "/c",
          "\"\"codex.cmd\" \"exec\" \"--json\" \"--skip-git-repo-check\" \"--file\" \"prompt file.md\"\""
        ]);
        expect(options).toEqual({
          stdio: ["ignore", "pipe", "pipe"],
          windowsVerbatimArguments: true
        });

        queueMicrotask(() => {
          child.emit("close", 0);
        });

        return child;
      }
    });

    await expect(output).resolves.toBe("");
  });

  runOnWindows("executes Windows cmd shims from paths with spaces", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codex shim test "));
    const shimPath = join(tempDir, "fake codex.cmd");
    const promptPath = join(tempDir, "prompt file.md");

    try {
      writeFileSync(
        shimPath,
        [
          "@echo off",
          "echo arg1=%~1",
          "echo arg2=%~2",
          "echo arg3=%~3",
          "echo arg4=%~4",
          "echo arg5=%~5"
        ].join("\r\n")
      );
      writeFileSync(promptPath, "prompt");

      const output = await runCodex(promptPath, {
        codexCommand: shimPath,
        platform: "win32"
      });

      expect(output.replace(/\r\n/g, "\n").trim()).toBe(
        [
          "arg1=exec",
          "arg2=--json",
          "arg3=--skip-git-repo-check",
          "arg4=--file",
          `arg5=${promptPath}`
        ].join("\n")
      );
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects with stderr when codex exits non-zero", async () => {
    const child = createMockChild();
    const output = runCodex("prompt-file.md", {
      spawn: () => {
        queueMicrotask(() => {
          child.stderr.emit("data", "bad prompt");
          child.emit("close", 2);
        });

        return child;
      }
    });

    await expect(output).rejects.toThrow("codex exited with 2: bad prompt");
  });

  it("rejects when spawning codex fails", async () => {
    const child = createMockChild();
    const output = runCodex("prompt-file.md", {
      spawn: () => {
        queueMicrotask(() => {
          child.emit("error", new Error("spawn failed"));
        });

        return child;
      }
    });

    await expect(output).rejects.toThrow("spawn failed");
  });
});
