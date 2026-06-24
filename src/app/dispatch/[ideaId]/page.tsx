import React from "react";
import { notFound } from "next/navigation";

import { DispatchForm } from "@/components/DispatchForm";
import { canDispatchIdeaForProfile } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  AUTONOMY_LEVELS,
  SPRINT_DEPTHS,
  type AutonomyLevel,
  type SprintDepth
} from "@/lib/domain";
import type { InboxReasoning } from "@/lib/inbox/service";

const fallbackReasoning: InboxReasoning = {
  whyPaperMatters: "",
  whyIdeaPromising: "",
  whyItMightBeTrap: "",
  smallestSprint: "",
  suggestedDepth: "default",
  suggestedAutonomy: "medium"
};

function parseInboxReasoning(reasoningJson: string): InboxReasoning {
  try {
    const parsed = JSON.parse(reasoningJson) as Partial<InboxReasoning> | null;

    if (!parsed || typeof parsed !== "object") {
      return fallbackReasoning;
    }

    const suggestedDepth = SPRINT_DEPTHS.includes(parsed.suggestedDepth as SprintDepth)
      ? (parsed.suggestedDepth as SprintDepth)
      : fallbackReasoning.suggestedDepth;
    const suggestedAutonomy = AUTONOMY_LEVELS.includes(parsed.suggestedAutonomy as AutonomyLevel)
      ? (parsed.suggestedAutonomy as AutonomyLevel)
      : fallbackReasoning.suggestedAutonomy;

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
      suggestedDepth,
      suggestedAutonomy
    };
  } catch {
    return fallbackReasoning;
  }
}

function suggestedDepthFromSmallestSprint(smallestSprint: string): SprintDepth {
  const normalized = smallestSprint.toLowerCase();

  if (normalized.includes("deep") || normalized.includes("overnight")) {
    return "deep";
  }

  if (normalized.includes("fast") || normalized.includes("triage")) {
    return "fast";
  }

  return "default";
}

export default async function DispatchPage({
  params
}: {
  params: Promise<{ ideaId: string }>;
  searchParams?: Promise<{ userId?: string | string[] }>;
}) {
  const [currentUser, { ideaId }] = await Promise.all([requireCurrentUser(), params]);
  const generatedIdea = await prisma.generatedIdea.findUnique({
    where: { id: ideaId },
    include: {
      paper: true,
      citations: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (generatedIdea) {
    if (
      !canDispatchIdeaForProfile({
        currentUserId: currentUser.id,
        generatedForUserId: generatedIdea.userId
      })
    ) {
      notFound();
    }

    const suggestedDepth = suggestedDepthFromSmallestSprint(generatedIdea.smallestSprint);

    return (
      <main className="min-h-screen bg-paper text-ink [color-scheme:light]">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <header className="mb-6">
            <p className="text-sm font-medium uppercase text-slate-500">Dispatch setup</p>
            <h1 className="text-3xl font-semibold">{generatedIdea.title}</h1>
            <p className="mt-2 text-slate-600">{generatedIdea.summary}</p>
          </header>

          <section className="mb-6 rounded-lg border border-line bg-white p-5">
            <h2 className="font-semibold">Generated idea details</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {generatedIdea.expandedExplanation}
            </p>
            <p className="mt-3 text-sm text-slate-600">
              <strong>Trajectory:</strong> {generatedIdea.trajectory}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              <strong>Smallest sprint:</strong> {generatedIdea.smallestSprint}
            </p>
          </section>

          <section className="mb-6 rounded-lg border border-line bg-white p-5">
            <h2 className="font-semibold">Source paper</h2>
            <p className="mt-1 text-slate-700">{generatedIdea.paper.title}</p>
            <p className="mt-2 text-sm text-slate-600">{generatedIdea.paper.abstract}</p>
            <a
              className="mt-3 inline-flex text-sm font-semibold text-accent"
              href={generatedIdea.paper.url}
              target="_blank"
              rel="noreferrer"
            >
              Open source paper
            </a>
          </section>

          {generatedIdea.citations.length > 0 ? (
            <section className="mb-6 rounded-lg border border-line bg-white p-5">
              <h2 className="font-semibold">Supporting citations</h2>
              <div className="mt-3 grid gap-3">
                {generatedIdea.citations.map((citation) => (
                  <a
                    key={citation.id}
                    className="block rounded-md border border-line p-3 text-sm text-slate-700"
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="font-semibold text-ink">{citation.title}</span>
                    <span className="mt-1 block text-slate-600">{citation.claim}</span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <DispatchForm
            generatedIdeaId={generatedIdea.id}
            suggestedDepth={suggestedDepth}
            suggestedAutonomy="medium"
          />
        </div>
      </main>
    );
  }

  const idea = await prisma.idea.findUnique({
    where: { id: ideaId },
    include: {
      paper: true,
      inboxItems: {
        where: { userId: currentUser.id },
        orderBy: [{ inboxDate: "desc" }, { createdAt: "desc" }],
        take: 1,
        include: { user: true }
      }
    }
  });

  if (!idea || idea.inboxItems.length === 0) {
    notFound();
  }

  const inboxItem = idea.inboxItems[0];
  const reasoning = parseInboxReasoning(inboxItem.reasoningJson);

  return (
    <main className="min-h-screen bg-paper text-ink [color-scheme:light]">
      <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase text-slate-500">Dispatch setup</p>
        <h1 className="text-3xl font-semibold">{idea.title}</h1>
        <p className="mt-2 text-slate-600">{idea.summary}</p>
      </header>

      <section className="mb-6 rounded-lg border border-line bg-white p-5">
        <h2 className="font-semibold">Source paper</h2>
        <p className="mt-1 text-slate-700">{idea.paper.title}</p>
        <p className="mt-2 text-sm text-slate-600">{idea.paper.abstract}</p>
      </section>

      <DispatchForm
        ideaId={idea.id}
        suggestedDepth={reasoning.suggestedDepth}
        suggestedAutonomy={reasoning.suggestedAutonomy}
      />
      </div>
    </main>
  );
}
