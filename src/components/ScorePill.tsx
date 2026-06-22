import React from "react";

type ScorePillProps = {
  label: string;
  value: number;
  tone?: "neutral" | "strong" | "warning";
};

const toneClass = {
  neutral: "border-slate-200 bg-white text-slate-900",
  strong: "border-teal-200 bg-teal-50 text-teal-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900"
} as const;

export function ScorePill({ label, value, tone = "neutral" }: ScorePillProps) {
  return (
    <div
      className={`min-h-16 min-w-[7rem] rounded-md border px-3 py-2 ${toneClass[tone]}`}
      data-tone={tone}
    >
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums leading-none">{value.toFixed(2)}</div>
    </div>
  );
}
