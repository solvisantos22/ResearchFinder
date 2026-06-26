"use client";

import React from "react";

type LauncherPanelProps = {
  appUrl: string;
  initialStatus: "online" | "offline";
  initialDesired: { inbox: boolean; research: boolean };
  registerLauncherAction: () => Promise<{ token: string }>;
  setLaneDesiredAction: (lane: "inbox" | "research", enabled: boolean) => Promise<{ inbox: boolean; research: boolean }>;
};

function quotePowerShellLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function LauncherPanel({
  appUrl,
  initialStatus,
  initialDesired,
  registerLauncherAction,
  setLaneDesiredAction
}: LauncherPanelProps) {
  const [token, setToken] = React.useState<string | null>(null);
  const [desired, setDesired] = React.useState(initialDesired);
  const [isPending, startTransition] = React.useTransition();

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

  const installCommand = token
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
            className={`inline-block h-2 w-2 rounded-full ${initialStatus === "online" ? "bg-rf-violet" : "bg-rf-border"}`}
          />
          <span className="text-sm text-rf-muted">{initialStatus}</span>
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
      ) : (
        <pre className="overflow-x-auto rounded-md bg-rf-surface p-4 text-sm text-rf-white">
          <code>{installCommand}</code>
        </pre>
      )}

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
    </section>
  );
}
