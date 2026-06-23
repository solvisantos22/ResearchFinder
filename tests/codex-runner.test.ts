import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCodexExecArgs, createCodexSpawnCommand, runCodex } from "@/worker/codex-runner";

const runOnWindows = process.platform === "win32" ? it : it.skip;
const runCodexCliContract = process.env.RESEARCHFINDER_TEST_CODEX_CLI === "1" ? it : it.skip;

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: {
      chunks: string[];
      ended: boolean;
      write: (chunk: string) => boolean;
      end: () => void;
    };
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    chunks: [],
    ended: false,
    write(chunk: string) {
      this.chunks.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
    }
  };

  return child;
}

function createTempPrompt(content = "Prompt text") {
  const tempDir = mkdtempSync(join(tmpdir(), "codex runner test "));
  const promptPath = join(tempDir, "prompt file.md");
  writeFileSync(promptPath, content);

  return { promptPath, tempDir };
}

describe("codex runner", () => {
  it("builds codex exec arguments for stdin prompts and final-message output", () => {
    expect(buildCodexExecArgs("last-message.txt")).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--output-last-message",
      "last-message.txt",
      "-"
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
      createCodexSpawnCommand(
        "C:\\Users\\Test User\\AppData\\Roaming\\npm\\codex.cmd",
        buildCodexExecArgs("C:\\Users\\Test User\\last message.txt"),
        "win32"
      )
    ).toEqual({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "\"\"%RESEARCHFINDER_CODEX_COMMAND%\" \"%RESEARCHFINDER_CODEX_ARG_0%\" \"%RESEARCHFINDER_CODEX_ARG_1%\" \"%RESEARCHFINDER_CODEX_ARG_2%\" \"%RESEARCHFINDER_CODEX_ARG_3%\" \"%RESEARCHFINDER_CODEX_ARG_4%\" \"%RESEARCHFINDER_CODEX_ARG_5%\"\""
      ],
      options: {
        windowsVerbatimArguments: true
      },
      envOverrides: {
        RESEARCHFINDER_CODEX_ARG_0: "exec",
        RESEARCHFINDER_CODEX_ARG_1: "--json",
        RESEARCHFINDER_CODEX_ARG_2: "--skip-git-repo-check",
        RESEARCHFINDER_CODEX_ARG_3: "--output-last-message",
        RESEARCHFINDER_CODEX_ARG_4: "C:\\Users\\Test User\\last message.txt",
        RESEARCHFINDER_CODEX_ARG_5: "-",
        RESEARCHFINDER_CODEX_COMMAND: "C:\\Users\\Test User\\AppData\\Roaming\\npm\\codex.cmd"
      }
    });
  });

  it("stores percent-containing Windows cmd shim arguments in env overrides", () => {
    const commandPlan = createCodexSpawnCommand(
      "codex.cmd",
      buildCodexExecArgs("C:\\Users\\Test User\\out %USERNAME%.txt"),
      "win32"
    );

    expect(commandPlan.args[3]).toContain("\"%RESEARCHFINDER_CODEX_ARG_4%\"");
    expect(commandPlan.envOverrides?.RESEARCHFINDER_CODEX_ARG_4).toBe(
      "C:\\Users\\Test User\\out %USERNAME%.txt"
    );
  });

  it("keeps direct Windows invocation for native exe commands", () => {
    expect(createCodexSpawnCommand("C:\\Tools\\codex.exe", ["exec"], "win32")).toEqual({
      command: "C:\\Tools\\codex.exe",
      args: ["exec"],
      options: {},
      envOverrides: undefined
    });
  });

  it("writes prompt file contents to stdin and returns the final-message output file", async () => {
    const { promptPath, tempDir } = createTempPrompt("Prompt file contents");
    const child = createMockChild();

    try {
      const output = runCodex(promptPath, {
        codexCommand: "codex",
        platform: "linux",
        spawn: (command, args, options) => {
          const outputPath = args[args.indexOf("--output-last-message") + 1];

          expect(command).toBe("codex");
          expect(args).toEqual(buildCodexExecArgs(outputPath));
          expect(options).toEqual({ stdio: ["pipe", "pipe", "pipe"] });

          queueMicrotask(() => {
            expect(child.stdin.chunks.join("")).toBe("Prompt file contents");
            expect(child.stdin.ended).toBe(true);
            child.stdout.emit("data", "{\"type\":\"event\"}\n");
            writeFileSync(outputPath, "final json document");
            child.emit("close", 0);
          });

          return child;
        }
      });

      await expect(output).resolves.toBe("final json document");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("uses the Windows cmd shim path by default on Windows", async () => {
    const { promptPath, tempDir } = createTempPrompt();
    const child = createMockChild();

    try {
      const output = runCodex(promptPath, {
        platform: "win32",
        spawn: (command, args, options) => {
          expect(command).toBe("cmd.exe");
          expect(args[0]).toBe("/d");
          expect(args[1]).toBe("/s");
          expect(args[2]).toBe("/c");
          expect(args[3]).toBe(
            "\"\"%RESEARCHFINDER_CODEX_COMMAND%\" \"%RESEARCHFINDER_CODEX_ARG_0%\" \"%RESEARCHFINDER_CODEX_ARG_1%\" \"%RESEARCHFINDER_CODEX_ARG_2%\" \"%RESEARCHFINDER_CODEX_ARG_3%\" \"%RESEARCHFINDER_CODEX_ARG_4%\" \"%RESEARCHFINDER_CODEX_ARG_5%\"\""
          );
          expect(options).toEqual(expect.objectContaining({
            stdio: ["pipe", "pipe", "pipe"],
            windowsVerbatimArguments: true
          }));
          expect(options.env).toEqual(expect.objectContaining({
            RESEARCHFINDER_CODEX_ARG_0: "exec",
            RESEARCHFINDER_CODEX_ARG_1: "--json",
            RESEARCHFINDER_CODEX_ARG_2: "--skip-git-repo-check",
            RESEARCHFINDER_CODEX_ARG_3: "--output-last-message",
            RESEARCHFINDER_CODEX_ARG_5: "-",
            RESEARCHFINDER_CODEX_COMMAND: "codex.cmd"
          }));

          const outputPath = options.env?.RESEARCHFINDER_CODEX_ARG_4;
          expect(outputPath).toBeTypeOf("string");

          queueMicrotask(() => {
            writeFileSync(outputPath as string, "windows final");
            child.emit("close", 0);
          });

          return child;
        }
      });

      await expect(output).resolves.toBe("windows final");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
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
          "(",
          "  echo arg1=%~1",
          "  echo arg2=%~2",
          "  echo arg3=%~3",
          "  echo arg4=%~4",
          "  echo arg6=%~6",
          ") > \"%~5\""
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
          "arg4=--output-last-message",
          "arg6=-"
        ].join("\n")
      );
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  runOnWindows("preserves percent output paths through npm-style Windows cmd shim forwarding", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codex percent %USERNAME% test "));
    const shimPath = join(tempDir, "fake codex.cmd");
    const writerPath = join(tempDir, "writer script.js");
    const promptPath = join(tempDir, "prompt %USERNAME% file.md");

    try {
      writeFileSync(
        shimPath,
        [
          "@echo off",
          "node \"%~dp0writer script.js\" %*"
        ].join("\r\n")
      );
      writeFileSync(
        writerPath,
        [
          "const fs = require('node:fs');",
          "const outputFile = process.argv[6];",
          "fs.writeFileSync(outputFile, `arg5=${outputFile}\\nstdin=${fs.readFileSync(0, 'utf8')}`);"
        ].join("\n")
      );
      writeFileSync(promptPath, `prompt path: ${promptPath}`);

      const output = await runCodex(promptPath, {
        codexCommand: shimPath,
        platform: "win32"
      });

      const normalizedOutput = output.replace(/\r\n/g, "\n").trim();
      const argLine = normalizedOutput.split("\n").find((line) => line.startsWith("arg5="));
      expect(argLine).toContain("%USERNAME%");
      expect(argLine).not.toContain("^%");
      expect(normalizedOutput).toContain(`stdin=prompt path: ${promptPath}`);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects with stderr when codex exits non-zero", async () => {
    const { promptPath, tempDir } = createTempPrompt();
    const child = createMockChild();

    try {
      const output = runCodex(promptPath, {
        spawn: () => {
          queueMicrotask(() => {
            child.stderr.emit("data", "bad prompt");
            child.emit("close", 2);
          });

          return child;
        }
      });

      await expect(output).rejects.toThrow("codex exited with 2: bad prompt");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects when spawning codex fails", async () => {
    const { promptPath, tempDir } = createTempPrompt();
    const child = createMockChild();
    try {
      const output = runCodex(promptPath, {
        spawn: () => {
          queueMicrotask(() => {
            child.emit("error", new Error("spawn failed"));
          });

          return child;
        }
      });

      await expect(output).rejects.toThrow("spawn failed");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  runCodexCliContract("documents the installed codex exec cli contract", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const commandPlan = createCodexSpawnCommand(
      process.platform === "win32" ? "codex.cmd" : "codex",
      ["exec", "--help"],
      process.platform
    );

    const { stdout } = await execFileAsync(commandPlan.command, commandPlan.args, commandPlan.options);

    expect(stdout).toContain("--output-last-message");
    expect(stdout).not.toContain("--file");
  });
});
