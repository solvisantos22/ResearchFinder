import React from "react";
import Link from "next/link";

import { developIdeaAction } from "@/app/research/actions";
import { noveltyLabelStyles, type NoveltyLabelKey } from "@/lib/ui/status-styles";

type IdeaCardProps = {
  idea: {
    id: string;
    title: string;
    summary: string;
    expandedExplanation: string;
    trajectory: string;
    noveltyStatus: string;
    overallScore: number;
    scoreExplanations: Record<string, string>;
    noveltyScan?: null | {
      label: string;
      confidence: number;
      summary: string;
      overlapExplanation: string;
      evidence: Array<{
        title: string;
        url: string;
        sourceType: string;
        overlapLevel: string;
        confidence: number;
      }>;
    };
  };
  canDispatch: boolean;
};

const LEGACY_NOVELTY_TO_CALIBRATED: Record<string, NoveltyLabelKey> = {
  verified: "likely_novel",
  needs_novelty_check: "unclear",
  not_novel: "near_duplicate"
};

function noveltyStatusChipClass(status: string): string {
  const key = (
    status in noveltyLabelStyles
      ? status
      : LEGACY_NOVELTY_TO_CALIBRATED[status] ?? "not_checked"
  ) as NoveltyLabelKey;
  return noveltyLabelStyles[key];
}

export function IdeaCard({ idea, canDispatch }: IdeaCardProps) {
  return (
    <section className="rounded-md border border-rf-border bg-rf-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p
            className={`inline-block rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-[0.16em] ${noveltyStatusChipClass(idea.noveltyStatus)}`}
          >
            {idea.noveltyStatus.replaceAll("_", " ")}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-rf-white">{idea.title}</h3>
          <p className="mt-2 text-sm leading-6 text-rf-muted">{idea.summary}</p>
        </div>
        <div className="grid h-12 w-12 place-items-center rounded-md bg-rf-violet text-sm font-black text-rf-white">
          {Math.round(idea.overallScore * 100)}
        </div>
      </div>

      {idea.noveltyScan ? (
        <div className="mt-3 rounded-md border border-rf-border bg-rf-panel p-3 text-sm text-rf-muted">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-2 py-0.5 text-xs font-semibold ${noveltyStatusChipClass(idea.noveltyScan.label)}`}
            >
              {idea.noveltyScan.label.replaceAll("_", " ")}
            </span>
            <span>{Math.round(idea.noveltyScan.confidence * 100)}% confidence</span>
          </div>
          <p className="mt-2">{idea.noveltyScan.summary}</p>
          <p className="mt-2">{idea.noveltyScan.overlapExplanation}</p>
          {idea.noveltyScan.evidence.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {idea.noveltyScan.evidence.map((evidence) => (
                <div
                  key={`${evidence.sourceType}-${evidence.url}-${evidence.title}`}
                  className="rounded border border-rf-border px-3 py-2"
                >
                  {evidence.url ? (
                    <a
                      href={evidence.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block font-medium text-rf-white hover:bg-rf-surface"
                    >
                      {evidence.title}
                    </a>
                  ) : (
                    <span className="block font-medium text-rf-white">{evidence.title}</span>
                  )}
                  <span className="text-xs text-rf-muted">
                    {evidence.sourceType} / {evidence.overlapLevel} /{" "}
                    {Math.round(evidence.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-rf-white">
          Idea reasoning
        </summary>
        <div className="mt-3 grid gap-3 text-sm leading-6 text-rf-muted">
          <p>{idea.expandedExplanation}</p>
          <p>
            <strong className="text-rf-white">Trajectory:</strong> {idea.trajectory}
          </p>
          {Object.entries(idea.scoreExplanations).map(([key, value]) => (
            <p key={key}>
              <strong className="text-rf-white">{key}:</strong> {value}
            </p>
          ))}
        </div>
      </details>

      {canDispatch ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/dispatch/${idea.id}`}
            className="inline-flex rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white"
          >
            Dispatch viability check
          </Link>
          <form action={developIdeaAction}>
            <input type="hidden" name="generatedIdeaId" value={idea.id} />
            <button
              type="submit"
              className="inline-flex rounded-md border border-rf-violetSoft bg-rf-surface px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-panel"
            >
              Develop this
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
