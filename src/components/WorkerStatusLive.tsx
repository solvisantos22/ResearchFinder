"use client";

import React, { useEffect, useState } from "react";

import { WorkerStatusPanel, type WorkerStatus } from "@/components/WorkerStatusPanel";

const POLL_MS = 30_000;
const RESTART_COMMAND = 'schtasks /run /tn "ResearchFinder Worker"';

type WorkerStatusLiveProps = {
  initialStatus: WorkerStatus;
  statusAction?: () => Promise<WorkerStatus>;
};

export function WorkerStatusLive({ initialStatus, statusAction }: WorkerStatusLiveProps) {
  const [status, setStatus] = useState<WorkerStatus>(initialStatus);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!statusAction) return;
    let active = true;
    const id = setInterval(() => {
      statusAction()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [statusAction]);

  return (
    <div className="grid gap-3">
      <WorkerStatusPanel status={status} />
      {status === "offline" ? (
        <div className="rounded-md border border-rf-border bg-rf-surface p-4 text-sm text-rf-muted">
          <p className="font-medium text-rf-white">Worker not running</p>
          <p className="mt-1">
            Double-click the <strong className="text-rf-white">ResearchFinder Worker</strong> shortcut
            on your Desktop or Start menu, or run this command in PowerShell:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-rf-panel px-2 py-1 text-rf-white">{RESTART_COMMAND}</code>
            <button
              type="button"
              aria-label={copied ? "Copied restart command" : "Copy restart command"}
              onClick={() => {
                if (!navigator.clipboard?.writeText) return;
                void navigator.clipboard.writeText(RESTART_COMMAND).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              className="rounded-md bg-rf-violet px-3 py-1 text-xs font-semibold text-rf-white transition-colors hover:bg-rf-violetSoft"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
