import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildCodexAgenticExecArgs, runCodexAgentic } from "@/worker/codex-runner";

type CapturedHandlers = {
  close?: (code: number | null) => void;
  error?: (error: Error) => void;
};

function createFakeAgenticChild() {
  const handlers: CapturedHandlers = {};
  const stdoutData: Array<(chunk: unknown) => void> = [];
  const stderrData: Array<(chunk: unknown) => void> = [];

  const child = {
    pid: 4321,
    kill: vi.fn(),
    stdin: {
      write: vi.fn(),
      end: vi.fn()
    },
    stdout: {
      on: vi.fn((event: string, listener: (chunk: unknown) => void) => {
        if (event === "data") stdoutData.push(listener);
      })
    },
    stderr: {
      on: vi.fn((event: string, listener: (chunk: unknown) => void) => {
        if (event === "data") stderrData.push(listener);
      })
    },
    on: vi.fn((event: string, listener: (...args: never[]) => void) => {
      if (event === "close") handlers.close = listener as CapturedHandlers["close"];
      if (event === "error") handlers.error = listener as CapturedHandlers["error"];
      return child;
    })
  };

  return { child, handlers, stdoutData, stderrData };
}

function createFakeLogSink() {
  return {
    chunks: [] as string[],
    ended: false,
    write(chunk: string) {
      this.chunks.push(chunk);
    },
    end() {
      this.ended = true;
    }
  };
}

describe("buildCodexAgenticExecArgs", () => {
  it("runs codex with full access, targets the workspace, and keeps structured output", () => {
    expect(buildCodexAgenticExecArgs("/out/last.txt", "/work/exp")).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--cd",
      "/work/exp",
      "--output-last-message",
      "/out/last.txt",
      "-"
    ]);
  });
});

describe("runCodexAgentic", () => {
  it("aborts by killing the child and tree-killing the process tree, then rejects", async () => {
    const { promptPath, tempDir } = createTempPrompt("agentic prompt");
    const { child, handlers } = createFakeAgenticChild();
    const killChildTree = vi.fn();
    const logSink = createFakeLogSink();
    const controller = new AbortController();

    try {
      const result = runCodexAgentic(promptPath, {
        workspaceDir: tempDir,
        platform: "win32",
        signal: controller.signal,
        spawn: () => child,
        killChildTree,
        createLogStream: () => logSink
      });

      controller.abort();
      // Drive the child's close handler the way the abort wiring leaves it
      // (process exits after being killed). Even without it, the abort rejects.
      handlers.close?.(null);

      await expect(result).rejects.toThrow();
      expect(child.kill).toHaveBeenCalled();
      expect(killChildTree).toHaveBeenCalledWith(child.pid, "win32");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("resolves with the output file contents on clean exit", async () => {
    const { promptPath, tempDir } = createTempPrompt("agentic prompt");
    const { child, handlers } = createFakeAgenticChild();
    const logSink = createFakeLogSink();

    try {
      const result = runCodexAgentic(promptPath, {
        workspaceDir: tempDir,
        platform: "linux",
        spawn: (_command, args) => {
          const outputPath = args[args.indexOf("--output-last-message") + 1];
          queueMicrotask(() => {
            writeFileSync(outputPath, "agentic final");
            handlers.close?.(0);
          });
          return child;
        },
        createLogStream: () => logSink
      });

      await expect(result).resolves.toBe("agentic final");
      expect(child.stdin.write).toHaveBeenCalledWith("agentic prompt");
      expect(child.stdin.end).toHaveBeenCalled();
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects with the failure message on non-zero exit", async () => {
    const { promptPath, tempDir } = createTempPrompt("agentic prompt");
    const { child, handlers, stderrData } = createFakeAgenticChild();
    const logSink = createFakeLogSink();

    try {
      const result = runCodexAgentic(promptPath, {
        workspaceDir: tempDir,
        platform: "linux",
        spawn: () => {
          queueMicrotask(() => {
            stderrData.forEach((listener) => listener("boom"));
            handlers.close?.(3);
          });
          return child;
        },
        createLogStream: () => logSink
      });

      await expect(result).rejects.toThrow("codex exited with 3: stderr: boom");
      expect(logSink.chunks.join("")).toContain("boom");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

function createTempPrompt(content = "Prompt text") {
  const dir = mkdtempSync(join(tmpdir(), "codex agentic test "));
  const promptPath = join(dir, "prompt file.md");
  writeFileSync(promptPath, content);

  return { promptPath, tempDir: dir };
}
