param(
  [Parameter(Mandatory=$true)][string]$AppUrl,
  [Parameter(Mandatory=$true)][string]$WorkerToken,
  [string]$InstallDir = "$env:LOCALAPPDATA\ResearchFinderWorker"
)

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

function ConvertTo-PowerShellLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Resolve-CodexCommandForNode([string]$ResolvedCodex) {
  if ([System.IO.Path]::GetExtension($ResolvedCodex).Equals(".ps1", [System.StringComparison]::OrdinalIgnoreCase)) {
    $cmdPath = [System.IO.Path]::ChangeExtension($ResolvedCodex, ".cmd")
    if (Test-Path -LiteralPath $cmdPath) {
      return $cmdPath
    }

    throw "Codex resolved to PowerShell shim at $ResolvedCodex, but sibling .cmd shim was not found at $cmdPath. Reinstall Codex or ensure npm cmd shims are available."
  }

  return $ResolvedCodex
}

$node = (Get-Command node -ErrorAction Stop).Source
$resolvedCodex = (Get-Command codex -ErrorAction Stop).Source
$codex = Resolve-CodexCommandForNode $resolvedCodex
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source

$configPath = Join-Path $InstallDir ".worker.json"
$configJson = @{
  appUrl = $AppUrl
  workerToken = $WorkerToken
  codexCommand = $codex
} | ConvertTo-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($configPath, $configJson, $utf8NoBom)

$repoPath = (Get-Location).Path
$tsxPath = Join-Path $repoPath "node_modules/tsx/dist/cli.mjs"
if (!(Test-Path -LiteralPath $tsxPath)) {
  throw "ResearchFinder worker install requires node_modules/tsx/dist/cli.mjs. Run npm install before installing the worker."
}

$runnerPath = Join-Path $InstallDir "run-worker.ps1"

$configLiteral = ConvertTo-PowerShellLiteral $configPath
$codexLiteral = ConvertTo-PowerShellLiteral $codex
$repoLiteral = ConvertTo-PowerShellLiteral $repoPath
$nodeLiteral = ConvertTo-PowerShellLiteral $node
$tsxLiteral = ConvertTo-PowerShellLiteral $tsxPath

@"
`$ErrorActionPreference = "Stop"
`$env:RESEARCHFINDER_WORKER_CONFIG = $configLiteral
`$env:RESEARCHFINDER_CODEX_COMMAND = $codexLiteral
Set-Location -LiteralPath $repoLiteral
& $nodeLiteral $tsxLiteral "scripts/researchfinder-worker.ts"
exit `$LASTEXITCODE
"@ | Set-Content -Path $runnerPath -Encoding UTF8

$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`"" `
  -WorkingDirectory $repoPath

$trigger = New-ScheduledTaskTrigger -Daily -At 6:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun

Register-ScheduledTask `
  -TaskName "ResearchFinder Worker" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Runs local Codex-backed ResearchFinder jobs for the signed-in user." `
  -Force | Out-Null

Write-Output "ResearchFinder worker installed. Config: $configPath. Codex: $codex"
