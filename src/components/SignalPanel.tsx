import React from "react";

import { signalStatusStyles, type SignalStatusKey } from "@/lib/ui/status-styles";

export type SignalStatus = SignalStatusKey;

type SignalPanelProps = {
  title: string;
  status: SignalStatus;
  summary: string;
  evidence: string;
};

export function SignalPanel({ title, status, summary, evidence }: SignalPanelProps) {
  return (
    <section
      className={`rounded-md border p-5 [overflow-wrap:anywhere] ${signalStatusStyles[status]}`}
      data-testid="signal-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="min-w-0 break-words text-lg font-semibold">{title}</h2>
        <span className="rounded-sm border border-current px-2 py-1 text-xs font-semibold uppercase leading-none">
          {status.toUpperCase()}
        </span>
      </div>
      <p className="mt-3 break-words text-sm font-medium">{summary}</p>
      <p className="mt-3 whitespace-pre-line break-words text-sm leading-6">{evidence}</p>
    </section>
  );
}
