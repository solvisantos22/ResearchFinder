import { describe, expect, it } from "vitest";

import { buildCodexExecArgs } from "@/worker/codex-runner";

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
});
