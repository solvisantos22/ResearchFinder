import React from "react";

export type SignalStatus = "pass" | "warning" | "fail";

type SignalPanelProps = {
  title: string;
  status: SignalStatus;
  summary: string;
  evidence: string;
};

const statusClass: Record<SignalStatus, string> = {
  pass: "border-teal-200 bg-teal-50 text-teal-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  fail: "border-rose-200 bg-rose-50 text-rose-900"
};

export function SignalPanel({ title, status, summary, evidence }: SignalPanelProps) {
  return (
    <section className={`rounded-md border p-5 ${statusClass[status]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="rounded-sm border border-current px-2 py-1 text-xs font-semibold uppercase leading-none">
          {status}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium">{summary}</p>
      <p className="mt-3 whitespace-pre-line text-sm leading-6">{evidence}</p>
    </section>
  );
}
