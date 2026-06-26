"use client";

import React, { useEffect, useState } from "react";

import { workerStatusStyles } from "@/lib/ui/status-styles";
import type { WorkerOverviewRow } from "@/lib/workers/overview";

const POLL_MS = 20_000;

type WorkersOverviewLiveProps = {
  initialWorkers: WorkerOverviewRow[];
  overviewAction?: () => Promise<WorkerOverviewRow[]>;
};

function elapsedLabel(startedAt: Date | null): string {
  if (!startedAt) return "";
  const ms = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m elapsed`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h elapsed`;
}

function laneBadge(lane: string) {
  return (
    <span className="rounded border border-rf-border bg-rf-surface px-2 py-0.5 text-xs font-bold uppercase tracking-[0.16em] text-rf-muted">
      {lane}
    </span>
  );
}

export function WorkersOverviewLive({ initialWorkers, overviewAction }: WorkersOverviewLiveProps) {
  const [workers, setWorkers] = useState<WorkerOverviewRow[]>(initialWorkers);

  useEffect(() => {
    if (!overviewAction) return;
    let active = true;
    const id = setInterval(() => {
      overviewAction()
        .then((next) => {
          if (active) setWorkers(next);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [overviewAction]);

  if (workers.length === 0) {
    return (
      <p className="rounded-md border border-rf-border bg-rf-surface p-4 text-sm text-rf-muted">
        No workers registered yet. Create one above to get started.
      </p>
    );
  }

  return (
    <ul className="grid gap-3">
      {workers.map((worker) => {
        const status = worker.status;
        const currentJobs = worker.currentJobs;
        const primary = currentJobs[0];
        return (
          <li key={worker.id} className="rounded-md border border-rf-border bg-rf-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium ${workerStatusStyles[status]}`}
                role="status"
              >
                <span className="h-2 w-2 shrink-0 rounded-sm bg-current" aria-hidden="true" />
                {status}
              </span>
              <span className="font-semibold text-rf-white">{worker.label}</span>
              {laneBadge(worker.lane)}
              <span className="text-sm text-rf-muted">
                {primary
                  ? `running ${primary.jobType}${currentJobs.length > 1 ? ` (+${currentJobs.length - 1} more)` : ""}`
                  : status === "online"
                    ? "idle"
                    : "—"}
              </span>
            </div>

            {currentJobs.length > 0 ? (
              <div className="mt-2 grid gap-1">
                {currentJobs.map((job) => (
                  <p key={job.jobId} className="text-sm text-rf-muted">
                    ▸ <span className="text-rf-white">{job.targetLabel}</span> · {elapsedLabel(job.startedAt)}
                  </p>
                ))}
              </div>
            ) : null}

            {worker.recentLogs.length > 0 ? (
              <ul className="mt-2 grid gap-1 text-xs text-rf-muted">
                {worker.recentLogs.map((log) => (
                  <li key={log.id}>
                    {log.level === "failed" ? "✗" : "✓"} {log.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
