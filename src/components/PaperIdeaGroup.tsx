import React from "react";
import type { ComponentProps } from "react";

import { IdeaCard } from "@/components/IdeaCard";
import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";

type PaperIdeaGroupProps = {
  currentUserId: string;
  generatedForUserId: string;
  enableDispatch?: boolean;
  paper: {
    title: string;
    abstract: string;
    url: string;
    authors: string[];
    categories: string[];
    publishedAt: string;
  };
  ideas: Array<ComponentProps<typeof IdeaCard>["idea"]>;
};

export function PaperIdeaGroup({
  currentUserId,
  generatedForUserId,
  enableDispatch = false,
  paper,
  ideas
}: PaperIdeaGroupProps) {
  const canDispatch =
    enableDispatch && canDispatchIdeaForProfile({ currentUserId, generatedForUserId });

  return (
    <article className="rounded-lg border border-rf-border bg-rf-panel p-5">
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-rf-muted">
        <span>{paper.authors.slice(0, 3).join(", ")}</span>
        <span>arXiv</span>
        <span>{paper.publishedAt}</span>
        <span>{paper.categories.join(", ")}</span>
      </div>
      <h2 className="text-xl font-semibold text-rf-white">{paper.title}</h2>
      <p className="mt-2 text-sm leading-6 text-rf-muted">{paper.abstract}</p>
      <a
        className="mt-4 inline-flex rounded-md border border-rf-border px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-surface"
        href={paper.url}
        target="_blank"
        rel="noreferrer"
      >
        Open source paper
      </a>
      <div className="mt-5 grid gap-3">
        {ideas.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} canDispatch={canDispatch} />
        ))}
      </div>
    </article>
  );
}
