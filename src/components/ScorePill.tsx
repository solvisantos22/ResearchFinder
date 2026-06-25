import React from "react";

import { scoreToneStyles, type ScoreToneKey } from "@/lib/ui/status-styles";

type ScorePillProps = {
  label: string;
  value: number;
  tone?: ScoreToneKey;
};

export function ScorePill({ label, value, tone = "neutral" }: ScorePillProps) {
  return (
    <div
      className={`min-h-16 min-w-[7rem] rounded-md border px-3 py-2 ${scoreToneStyles[tone]}`}
      data-testid="score-pill"
      data-tone={tone}
    >
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-rf-muted">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums leading-none">{value.toFixed(2)}</div>
    </div>
  );
}
