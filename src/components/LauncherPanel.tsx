"use client";

import React from "react";

const POLL_MS = 20_000;

type LauncherPanelProps = {
  appUrl: string;
  initialStatus: "online" | "offline";
  initialDesired: { inbox: boolean; research: boolean };
  registerLauncherAction: () => Promise<{ token: string }>;
  setLaneDesiredAction: (lane: "inbox" | "research", enabled: boolean) => Promise<{ inbox: boolean; research: boolean }>;
  restartLauncherAction: () => Promise<void>;
  overviewAction?: () => Promise<{ status: "online" | "offline"; desired: { inbox: boolean; research: boolean } }>;
};

function quotePowerShellLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteShellLiteral(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function LauncherPanel({
  appUrl,
  initialStatus,
  initialDesired,
  registerLauncherAction,
  setLaneDesiredAction,
  restartLauncherAction,
  overviewAction
}: LauncherPanelProps) {
  const [token, setToken] = React.useState<string | null>(null);
  const [desired, setDesired] = React.useState(initialDesired);
  const [status, setStatus] = React.useState(initialStatus);
  const [restartNotice, setRestartNotice] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!overviewAction) return;
    let active = true;
    const id = setInterval(() => {
      overviewAction()
        .then((next) => {
          if (active) setStatus(next.status);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [overviewAction]);

  function handleRegister() {
    startTransition(async () => {
      const result = await registerLauncherAction();
      setToken(result.token);
    });
  }

  function handleToggle(lane: "inbox" | "research", nextEnabled: boolean) {
    startTransition(async () => {
      const next = await setLaneDesiredAction(lane, nextEnabled);
      setDesired(next);
    });
  }

  function handleRestart() {
    startTransition(async () => {
      await restartLauncherAction();
      setRestartNotice("Restart requested — workers bounce within ~20s.");
    });
  }

  const macInstallCommand = token
    ? `bash scripts/install-launcher.sh --app-url ${quoteShellLiteral(appUrl)} --launcher-token ${quoteShellLiteral(token)}`
    : null;
  const windowsInstallCommand = token
    ? `powershell -ExecutionPolicy Bypass -File scripts/install-launcher.ps1 -AppUrl ${quotePowerShellLiteral(appUrl)} -LauncherToken ${quotePowerShellLiteral(token)}`
    : null;

  return (
    <section className="mb-6 rounded-md border border-rf-border bg-rf-panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-rf-white">Local launcher</h2>
          <p className="mt-1 text-sm text-rf-muted">
            Register a local launcher to automatically start and stop lane workers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${status === "online" ? "bg-rf-violet" : "bg-rf-border"}`}
          />
          <span className="text-sm text-rf-muted">{status}</span>
        </div>
      </div>

      {token === null ? (
        <button
          type="button"
          onClick={handleRegister}
          disabled={isPending}
          className="rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-violetSoft disabled:cursor-not-allowed disabled:bg-rf-border"
        >
          Register launcher
        </button>
      ) : macInstallCommand && windowsInstallCommand ? (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rf-muted">macOS</p>
            <pre className="overflow-x-auto rounded-md bg-rf-surface p-4 text-sm text-rf-white">
              <code>{macInstallCommand}</code>
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rf-muted">Windows</p>
            <pre className="overflow-x-auto rounded-md bg-rf-surface p-4 text-sm text-rf-white">
              <code>{windowsInstallCommand}</code>
            </pre>
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="mb-2 text-sm font-medium text-rf-white">Lane toggles</p>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-rf-muted">
            <input
              type="checkbox"
              checked={desired.inbox}
              onChange={(e) => handleToggle("inbox", e.target.checked)}
              disabled={isPending}
              className="accent-rf-violet"
            />
            Inbox
          </label>
          <label className="flex items-center gap-2 text-sm text-rf-muted">
            <input
              type="checkbox"
              checked={desired.research}
              onChange={(e) => handleToggle("research", e.target.checked)}
              disabled={isPending}
              className="accent-rf-violet"
            />
            Research
          </label>
        </div>
        <p className="mt-2 text-xs text-rf-muted">Changes apply within ~20s.</p>
      </div>

      <div className="mt-5 border-t border-rf-border pt-4">
        <button
          type="button"
          onClick={handleRestart}
          disabled={isPending}
          className="rounded-md border border-rf-border px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          Restart workers
        </button>
        <p className="mt-2 text-xs text-rf-muted">
          {restartNotice ?? "Reloads worker code (e.g. after a deploy). Applies within ~20s."}
        </p>
      </div>
    </section>
  );
}
