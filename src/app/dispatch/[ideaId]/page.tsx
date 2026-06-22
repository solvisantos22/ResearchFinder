import { notFound } from "next/navigation";

import { DispatchForm } from "@/components/DispatchForm";
import { prisma } from "@/lib/db";
import {
  AUTONOMY_LEVELS,
  SPRINT_DEPTHS,
  type AutonomyLevel,
  type SprintDepth
} from "@/lib/domain";

type DispatchSuggestion = {
  suggestedDepth: SprintDepth;
  suggestedAutonomy: AutonomyLevel;
};

const fallbackSuggestion: DispatchSuggestion = {
  suggestedDepth: "default",
  suggestedAutonomy: "medium"
};

function parseDispatchSuggestion(reasoningJson: string): DispatchSuggestion {
  try {
    const parsed = JSON.parse(reasoningJson) as {
      suggestedDepth?: unknown;
      suggestedAutonomy?: unknown;
    } | null;

    if (!parsed || typeof parsed !== "object") {
      return fallbackSuggestion;
    }

    const suggestedDepth = SPRINT_DEPTHS.includes(parsed.suggestedDepth as SprintDepth)
      ? (parsed.suggestedDepth as SprintDepth)
      : fallbackSuggestion.suggestedDepth;
    const suggestedAutonomy = AUTONOMY_LEVELS.includes(parsed.suggestedAutonomy as AutonomyLevel)
      ? (parsed.suggestedAutonomy as AutonomyLevel)
      : fallbackSuggestion.suggestedAutonomy;

    return { suggestedDepth, suggestedAutonomy };
  } catch {
    return fallbackSuggestion;
  }
}

export default async function DispatchPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  const idea = await prisma.idea.findUnique({
    where: { id: ideaId },
    include: {
      paper: true,
      inboxItems: {
        take: 1,
        include: { user: true }
      }
    }
  });

  if (!idea || idea.inboxItems.length === 0) {
    notFound();
  }

  const inboxItem = idea.inboxItems[0];
  const suggestion = parseDispatchSuggestion(inboxItem.reasoningJson);

  return (
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
        userId={inboxItem.userId}
        suggestedDepth={suggestion.suggestedDepth}
        suggestedAutonomy={suggestion.suggestedAutonomy}
      />
    </div>
  );
}
