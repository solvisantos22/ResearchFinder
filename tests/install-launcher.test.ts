import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const installerScript = readFileSync(join(process.cwd(), "scripts", "install-launcher.ps1"), "utf8");

describe("launcher installer", () => {
  it("runs the scheduled launcher through a wrapper that points at the installed config", () => {
    expect(installerScript).toContain("$runnerPath = Join-Path $InstallDir \"run-launcher.ps1\"");
    expect(installerScript).toContain("$env:RESEARCHFINDER_LAUNCHER_CONFIG");
    expect(installerScript).toContain("$env:RESEARCHFINDER_CODEX_COMMAND");
    expect(installerScript).toContain("$configPath");
    expect(installerScript).toContain("-File");
    expect(installerScript).toContain("$runnerPath");
  });

  it("persists the resolved codex command for launcher runs", () => {
    expect(installerScript).toContain("codexCommand = $codex");
    expect(installerScript).toContain("$codexLiteral = ConvertTo-PowerShellLiteral $codex");
    expect(installerScript).toContain("$env:RESEARCHFINDER_CODEX_COMMAND = $codexLiteral");
  });

  it("normalizes PowerShell codex shims to Node-runnable cmd shims", () => {
    expect(installerScript).toContain("function Resolve-CodexCommandForNode([string]$ResolvedCodex)");
    expect(installerScript).toContain('".ps1"');
    expect(installerScript).toContain('[System.IO.Path]::ChangeExtension($ResolvedCodex, ".cmd")');
    expect(installerScript).toContain("Test-Path -LiteralPath $cmdPath");
    expect(installerScript).toContain("sibling .cmd shim was not found");
    expect(installerScript).toContain("$codex = Resolve-CodexCommandForNode $resolvedCodex");
  });

  it("resolves codex before writing it to the launcher config", () => {
    const codexResolutionIndex = installerScript.indexOf("$resolvedCodex = (Get-Command codex -ErrorAction Stop).Source");
    const codexNormalizationIndex = installerScript.indexOf("$codex = Resolve-CodexCommandForNode $resolvedCodex");
    const configCodexIndex = installerScript.indexOf("codexCommand = $codex");
    const configWriteIndex = installerScript.indexOf("[System.IO.File]::WriteAllText($configPath, $configJson, $utf8NoBom)");

    expect(codexResolutionIndex).toBeGreaterThanOrEqual(0);
    expect(codexNormalizationIndex).toBeGreaterThanOrEqual(0);
    expect(configCodexIndex).toBeGreaterThanOrEqual(0);
    expect(configWriteIndex).toBeGreaterThanOrEqual(0);
    expect(codexResolutionIndex).toBeLessThan(codexNormalizationIndex);
    expect(codexNormalizationIndex).toBeLessThan(configCodexIndex);
    expect(configCodexIndex).toBeLessThan(configWriteIndex);
  });

  it("writes the installed config as utf8 without a BOM", () => {
    expect(installerScript).toContain("New-Object System.Text.UTF8Encoding $false");
    expect(installerScript).toContain("[System.IO.File]::WriteAllText($configPath, $configJson, $utf8NoBom)");
  });

  it("uses LauncherToken param (not WorkerToken) and writes .launcher.json", () => {
    expect(installerScript).toContain("[Parameter(Mandatory=$true)][string]$LauncherToken");
    expect(installerScript).toContain('".launcher.json"');
    expect(installerScript).toContain("appUrl = $AppUrl");
    expect(installerScript).toContain("launcherToken = $LauncherToken");
  });

  it("fails fast when the local tsx cli is missing", () => {
    expect(installerScript).toContain("$tsxPath = Join-Path $repoPath \"node_modules/tsx/dist/cli.mjs\"");
    expect(installerScript).toContain("if (!(Test-Path -LiteralPath $tsxPath))");
    expect(installerScript).toContain("node_modules/tsx/dist/cli.mjs");
    expect(installerScript).toContain("$tsxLiteral = ConvertTo-PowerShellLiteral $tsxPath");
    expect(installerScript).toContain("& $nodeLiteral $tsxLiteral \"scripts/researchfinder-launcher.ts\"");
  });
});

describe("launcher installer resilience", () => {
  it("starts at logon only (no daily trigger)", () => {
    expect(installerScript).toContain("New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME");
    expect(installerScript).not.toContain("New-ScheduledTaskTrigger -Daily");
  });

  it("restarts on failure and never wakes the machine", () => {
    expect(installerScript).toContain("-RestartCount");
    expect(installerScript).toContain("-RestartInterval");
    expect(installerScript).toContain("-MultipleInstances IgnoreNew");
    expect(installerScript).not.toContain("-WakeToRun");
  });

  it("creates a double-click ResearchFinder Launcher shortcut", () => {
    expect(installerScript).toContain("WScript.Shell");
    expect(installerScript).toContain('("{0}.lnk" -f $TaskName)');
    expect(installerScript).toContain(".Save()");
  });

  it("uses the task name parameter for the scheduled task and defaults to ResearchFinder Launcher", () => {
    expect(installerScript).toContain("-TaskName $TaskName");
    expect(installerScript).toContain('[string]$TaskName = "ResearchFinder Launcher"');
  });

  it("uses ResearchFinderLauncher install dir", () => {
    expect(installerScript).toContain("$env:LOCALAPPDATA\\ResearchFinderLauncher");
  });
});
