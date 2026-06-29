#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/install-worker.sh --app-url <url> --worker-token <token> [--task-name <name>] [--install-dir <path>]

Installs a manual ResearchFinder worker as a per-user macOS launchd agent.
Run this from the ResearchFinder repo root after npm install.
USAGE
}

app_url=""
worker_token=""
task_name="ResearchFinder Worker"
install_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-url|-AppUrl)
      app_url="${2:-}"
      shift 2
      ;;
    --worker-token|-WorkerToken)
      worker_token="${2:-}"
      shift 2
      ;;
    --task-name|-TaskName)
      task_name="${2:-}"
      shift 2
      ;;
    --install-dir|-InstallDir)
      install_dir="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$app_url" || -z "$worker_token" ]]; then
  usage >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer currently supports macOS launchd only." >&2
  exit 1
fi

safe_name="$(printf '%s' "$task_name" | tr -cd '[:alnum:] _-' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
if [[ -z "$safe_name" ]]; then
  safe_name="ResearchFinder Worker"
fi

if [[ -z "$install_dir" ]]; then
  install_dir="$HOME/Library/Application Support/ResearchFinderWorker/$safe_name"
fi

node_path="$(command -v node || true)"
if [[ -z "$node_path" ]]; then
  echo "ResearchFinder worker install requires node on PATH." >&2
  exit 1
fi

codex_path="$(command -v codex || true)"
if [[ -z "$codex_path" ]]; then
  echo "ResearchFinder worker install requires codex on PATH." >&2
  exit 1
fi

repo_path="$(pwd -P)"
tsx_path="$repo_path/node_modules/tsx/dist/cli.mjs"
if [[ ! -f "$tsx_path" ]]; then
  echo "ResearchFinder worker install requires node_modules/tsx/dist/cli.mjs. Run npm install before installing the worker." >&2
  exit 1
fi

mkdir -p "$install_dir" "$HOME/Library/LaunchAgents"

label_suffix="$(
  printf '%s' "$task_name" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9.-]+/-/g;s/^-+//;s/-+$//'
)"
if [[ -z "$label_suffix" || "$label_suffix" == "researchfinder-worker" ]]; then
  launchd_label="com.researchfinder.worker"
else
  launchd_label="com.researchfinder.worker.$label_suffix"
fi

config_path="$install_dir/.worker.json"
runner_path="$install_dir/run-worker.sh"
stdout_path="$install_dir/worker.out.log"
stderr_path="$install_dir/worker.err.log"
plist_path="$HOME/Library/LaunchAgents/$launchd_label.plist"

APP_URL="$app_url" \
WORKER_TOKEN="$worker_token" \
CODEX_COMMAND="$codex_path" \
CONFIG_PATH="$config_path" \
RUNNER_PATH="$runner_path" \
REPO_PATH="$repo_path" \
NODE_PATH="$node_path" \
TSX_PATH="$tsx_path" \
PLIST_PATH="$plist_path" \
LAUNCHD_LABEL="$launchd_label" \
STDOUT_PATH="$stdout_path" \
STDERR_PATH="$stderr_path" \
"$node_path" <<'NODE'
const fs = require("node:fs");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function xmlEscape(value) {
  return value.replace(/[<>&'"]/g, (character) => {
    switch (character) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return character;
    }
  });
}

const configPath = required("CONFIG_PATH");
const runnerPath = required("RUNNER_PATH");
const plistPath = required("PLIST_PATH");

fs.writeFileSync(
  configPath,
  `${JSON.stringify({
    appUrl: required("APP_URL"),
    workerToken: required("WORKER_TOKEN"),
    codexCommand: required("CODEX_COMMAND")
  }, null, 2)}\n`,
  "utf8"
);

fs.writeFileSync(
  runnerPath,
  [
    "#!/bin/sh",
    "set -eu",
    `export RESEARCHFINDER_WORKER_CONFIG=${shellQuote(configPath)}`,
    `export RESEARCHFINDER_CODEX_COMMAND=${shellQuote(required("CODEX_COMMAND"))}`,
    `cd ${shellQuote(required("REPO_PATH"))}`,
    `exec ${shellQuote(required("NODE_PATH"))} ${shellQuote(required("TSX_PATH"))} scripts/researchfinder-worker.ts`,
    ""
  ].join("\n"),
  "utf8"
);
fs.chmodSync(runnerPath, 0o755);

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(required("LAUNCHD_LABEL"))}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(runnerPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(required("REPO_PATH"))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(required("STDOUT_PATH"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(required("STDERR_PATH"))}</string>
</dict>
</plist>
`;
fs.writeFileSync(plistPath, plist, "utf8");
NODE

launch_domain="gui/$(id -u)"
launchctl bootout "$launch_domain" "$plist_path" >/dev/null 2>&1 || true
launchctl bootstrap "$launch_domain" "$plist_path"
launchctl enable "$launch_domain/$launchd_label"
launchctl kickstart -k "$launch_domain/$launchd_label"

echo "ResearchFinder worker installed."
echo "Config: $config_path"
echo "LaunchAgent: $plist_path"
echo "Logs: $stdout_path $stderr_path"
echo "Codex: $codex_path"
