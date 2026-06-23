import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const installerScript = readFileSync(join(process.cwd(), "scripts", "install-worker.ps1"), "utf8");

describe("worker installer", () => {
  it("runs the scheduled worker through a wrapper that points at the installed config", () => {
    expect(installerScript).toContain("$runnerPath = Join-Path $InstallDir \"run-worker.ps1\"");
    expect(installerScript).toContain("$env:RESEARCHFINDER_WORKER_CONFIG");
    expect(installerScript).toContain("$configPath");
    expect(installerScript).toContain("-File");
    expect(installerScript).toContain("$runnerPath");
  });

  it("writes the installed config as utf8 without a BOM", () => {
    expect(installerScript).toContain("New-Object System.Text.UTF8Encoding $false");
    expect(installerScript).toContain("[System.IO.File]::WriteAllText($configPath, $configJson, $utf8NoBom)");
  });
});
