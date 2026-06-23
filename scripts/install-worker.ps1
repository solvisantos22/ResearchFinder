param(
  [Parameter(Mandatory=$true)][string]$AppUrl,
  [Parameter(Mandatory=$true)][string]$WorkerToken,
  [string]$InstallDir = "$env:LOCALAPPDATA\ResearchFinderWorker"
)

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$configPath = Join-Path $InstallDir ".worker.json"
@{
  appUrl = $AppUrl
  workerToken = $WorkerToken
} | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

$node = (Get-Command node -ErrorAction Stop).Source
$codex = (Get-Command codex -ErrorAction Stop).Source

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "node_modules/tsx/dist/cli.mjs scripts/researchfinder-worker.ts" `
  -WorkingDirectory (Get-Location).Path

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
