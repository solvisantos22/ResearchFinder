import React from "react";
import Link from "next/link";

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
  };
  canDispatch: boolean;
};

export function IdeaCard({ idea, canDispatch }: IdeaCardProps) {
  return (
    <section className="rounded-md border border-rf-border bg-rf-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-rf-violet">
            {idea.noveltyStatus.replaceAll("_", " ")}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-rf-white">{idea.title}</h3>
          <p className="mt-2 text-sm leading-6 text-rf-muted">{idea.summary}</p>
        </div>
        <div className="grid h-12 w-12 place-items-center rounded-md bg-rf-violet text-sm font-black text-white">
          {Math.round(idea.overallScore * 100)}
        </div>
      </div>

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
        <Link
          href={`/dispatch/${idea.id}`}
          className="mt-4 inline-flex rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-white"
        >
          Dispatch viability check
        </Link>
      ) : null}
    </section>
  );
}
