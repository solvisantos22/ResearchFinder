import React from "react";

export type WorkerStatus = "online" | "offline" | "needs_auth" | "unknown";

type WorkerStatusPanelProps = {
  status: WorkerStatus;
};

const statusLabel: Record<WorkerStatus, string> = {
  online: "online",
  offline: "offline",
  needs_auth: "needs auth",
  unknown: "unknown"
};

const statusClass: Record<WorkerStatus, string> = {
  online: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  offline: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  needs_auth: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  unknown: "border-rf-border bg-rf-surface text-rf-muted"
};

export function WorkerStatusPanel({ status }: WorkerStatusPanelProps) {
  return (
    <div
      className={`inline-flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${statusClass[status]}`}
      data-testid="worker-status"
    >
      <span className="h-2 w-2 shrink-0 rounded-sm bg-current" aria-hidden="true" />
      <span className="min-w-0 break-words">Worker {statusLabel[status]}</span>
    </div>
  );
}
