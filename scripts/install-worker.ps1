param(
  [Parameter(Mandatory=$true)][string]$AppUrl,
  [Parameter(Mandatory=$true)][string]$WorkerToken,
  [string]$InstallDir = "$env:LOCALAPPDATA\ResearchFinderWorker"
)

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

function ConvertTo-PowerShellLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

$configPath = Join-Path $InstallDir ".worker.json"
$configJson = @{
  appUrl = $AppUrl
  workerToken = $WorkerToken
} | ConvertTo-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($configPath, $configJson, $utf8NoBom)

$node = (Get-Command node -ErrorAction Stop).Source
$codex = (Get-Command codex -ErrorAction Stop).Source
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$repoPath = (Get-Location).Path
$runnerPath = Join-Path $InstallDir "run-worker.ps1"

$configLiteral = ConvertTo-PowerShellLiteral $configPath
$repoLiteral = ConvertTo-PowerShellLiteral $repoPath
$nodeLiteral = ConvertTo-PowerShellLiteral $node

@"
`$ErrorActionPreference = "Stop"
`$env:RESEARCHFINDER_WORKER_CONFIG = $configLiteral
Set-Location -LiteralPath $repoLiteral
& $nodeLiteral "node_modules/tsx/dist/cli.mjs" "scripts/researchfinder-worker.ts"
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
