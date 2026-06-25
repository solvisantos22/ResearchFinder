import React from "react";

import { workerStatusStyles } from "@/lib/ui/status-styles";

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

export function WorkerStatusPanel({ status }: WorkerStatusPanelProps) {
  return (
    <div
      className={`inline-flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${workerStatusStyles[status]}`}
      data-testid="worker-status"
      role="status"
    >
      <span className="h-2 w-2 shrink-0 rounded-sm bg-current" aria-hidden="true" />
      <span className="min-w-0 break-words">Worker {statusLabel[status]}</span>
    </div>
  );
}
