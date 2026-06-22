import React from "react";
import Link from "next/link";

import { ScorePill } from "@/components/ScorePill";
import type { InboxReasoning } from "@/lib/inbox/service";

type PaperCardProps = {
  item: {
    id: string;
    overallScore: number;
    paperQuality: number;
    projectOpportunity: number;
    dispatchLikelihood: number;
    reasoningJson: string;
    paper: {
      title: string;
      abstract: string;
      url: string;
      authorsJson: string;
      categoriesJson: string;
      publishedAt: Date;
    };
    bestIdea: {
      id: string;
      title: string;
      summary: string;
      rationale: string;
      approach: string;
    };
  };
};

const fallbackReasoning: InboxReasoning = {
  whyPaperMatters: "Reasoning unavailable.",
  whyIdeaPromising: "Reasoning unavailable.",
  whyItMightBeTrap: "Reasoning unavailable.",
  smallestSprint: "Reasoning unavailable.",
  suggestedDepth: "fast",
  suggestedAutonomy: "low"
};

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseReasoning(value: string): InboxReasoning {
  try {
    const parsed = JSON.parse(value) as Partial<InboxReasoning> | null;
    if (!parsed || typeof parsed !== "object") {
      return fallbackReasoning;
    }

    return {
      whyPaperMatters:
        typeof parsed.whyPaperMatters === "string"
          ? parsed.whyPaperMatters
          : fallbackReasoning.whyPaperMatters,
      whyIdeaPromising:
        typeof parsed.whyIdeaPromising === "string"
          ? parsed.whyIdeaPromising
          : fallbackReasoning.whyIdeaPromising,
      whyItMightBeTrap:
        typeof parsed.whyItMightBeTrap === "string"
          ? parsed.whyItMightBeTrap
          : fallbackReasoning.whyItMightBeTrap,
      smallestSprint:
        typeof parsed.smallestSprint === "string"
          ? parsed.smallestSprint
          : fallbackReasoning.smallestSprint,
      suggestedDepth:
        parsed.suggestedDepth === "fast" ||
        parsed.suggestedDepth === "default" ||
        parsed.suggestedDepth === "deep"
          ? parsed.suggestedDepth
          : fallbackReasoning.suggestedDepth,
      suggestedAutonomy:
        parsed.suggestedAutonomy === "low" ||
        parsed.suggestedAutonomy === "medium" ||
        parsed.suggestedAutonomy === "high"
          ? parsed.suggestedAutonomy
          : fallbackReasoning.suggestedAutonomy
    };
  } catch {
    return fallbackReasoning;
  }
}

export function PaperCard({ item }: PaperCardProps) {
  const reasoning = parseReasoning(item.reasoningJson);
  const authors = parseStringArray(item.paper.authorsJson);
  const categories = parseStringArray(item.paper.categoriesJson);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-3xl flex-1">
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{item.paper.publishedAt.toISOString().slice(0, 10)}</span>
            <span className="min-w-0 truncate">{authors.slice(0, 3).join(", ")}</span>
            <span className="min-w-0 truncate">{categories.join(", ")}</span>
          </div>
          <h2 className="text-xl font-semibold leading-tight text-slate-900">{item.paper.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{item.paper.abstract}</p>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Best idea
            </div>
            <h3 className="mt-1 font-semibold text-slate-900">{item.bestIdea.title}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">{item.bestIdea.summary}</p>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:w-64 lg:w-64 lg:flex-none">
          <ScorePill label="Overall" value={item.overallScore} tone="strong" />
          <ScorePill label="Paper" value={item.paperQuality} />
          <ScorePill label="Opportunity" value={item.projectOpportunity} />
          <ScorePill
            label="Dispatch"
            value={item.dispatchLikelihood}
            tone={item.dispatchLikelihood < 0.55 ? "warning" : "neutral"}
          />
        </div>
      </div>

      <details className="mt-4 rounded-md border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
          Expandable reasoning
        </summary>
        <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-2">
          <p>
            <strong>Why it matters:</strong> {reasoning.whyPaperMatters}
          </p>
          <p>
            <strong>Why promising:</strong> {reasoning.whyIdeaPromising}
          </p>
          <p>
            <strong>Trap risk:</strong> {reasoning.whyItMightBeTrap}
          </p>
          <p>
            <strong>Smallest sprint:</strong> {reasoning.smallestSprint}
          </p>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800"
          href={`/dispatch/${item.bestIdea.id}`}
        >
          Dispatch viability sprint
        </Link>
        <a
          className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          href={item.paper.url}
          target="_blank"
          rel="noreferrer"
        >
          Open source paper
        </a>
      </div>
    </article>
  );
}
