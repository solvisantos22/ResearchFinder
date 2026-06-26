param(
  [Parameter(Mandatory=$true)][string]$AppUrl,
  [Parameter(Mandatory=$true)][string]$LauncherToken,
  [string]$TaskName = "ResearchFinder Launcher",
  [string]$InstallDir = ""
)

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $safeName = ($TaskName -replace '[^A-Za-z0-9 _-]', '').Trim()
  if ([string]::IsNullOrWhiteSpace($safeName)) { $safeName = "ResearchFinder Launcher" }
  $InstallDir = Join-Path "$env:LOCALAPPDATA\ResearchFinderLauncher" $safeName
}

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

$configPath = Join-Path $InstallDir ".launcher.json"
$configJson = @{
  appUrl = $AppUrl
  launcherToken = $LauncherToken
  codexCommand = $codex
} | ConvertTo-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($configPath, $configJson, $utf8NoBom)

$repoPath = (Get-Location).Path
$tsxPath = Join-Path $repoPath "node_modules/tsx/dist/cli.mjs"
if (!(Test-Path -LiteralPath $tsxPath)) {
  throw "ResearchFinder launcher install requires node_modules/tsx/dist/cli.mjs. Run npm install before installing the launcher."
}

$runnerPath = Join-Path $InstallDir "run-launcher.ps1"

$configLiteral = ConvertTo-PowerShellLiteral $configPath
$codexLiteral = ConvertTo-PowerShellLiteral $codex
$repoLiteral = ConvertTo-PowerShellLiteral $repoPath
$nodeLiteral = ConvertTo-PowerShellLiteral $node
$tsxLiteral = ConvertTo-PowerShellLiteral $tsxPath

@"
`$ErrorActionPreference = "Stop"
`$env:RESEARCHFINDER_LAUNCHER_CONFIG = $configLiteral
`$env:RESEARCHFINDER_CODEX_COMMAND = $codexLiteral
Set-Location -LiteralPath $repoLiteral
& $nodeLiteral $tsxLiteral "scripts/researchfinder-launcher.ts"
exit `$LASTEXITCODE
"@ | Set-Content -Path $runnerPath -Encoding UTF8

$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`"" `
  -WorkingDirectory $repoPath

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $logonTrigger `
  -Settings $settings `
  -Description "Runs the always-on ResearchFinder launcher that manages local Codex workers for the signed-in user." `
  -Force | Out-Null

$WshShell = New-Object -ComObject WScript.Shell
$shortcutDirs = @(
  [Environment]::GetFolderPath("Desktop"),
  [Environment]::GetFolderPath("Programs")
)
foreach ($dir in $shortcutDirs) {
  $shortcutPath = Join-Path $dir ("{0}.lnk" -f $TaskName)
  $shortcut = $WshShell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
  $shortcut.WorkingDirectory = $repoPath
  $shortcut.Description = "Start the ResearchFinder launcher"
  $shortcut.Save()
}

Write-Output "ResearchFinder launcher installed. Config: $configPath. Codex: $codex"
