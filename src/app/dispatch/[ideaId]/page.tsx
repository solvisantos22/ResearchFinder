import { notFound } from "next/navigation";

import { DispatchForm } from "@/components/DispatchForm";
import { prisma } from "@/lib/db";
import type { InboxReasoning } from "@/lib/inbox/service";

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
  const reasoning = JSON.parse(inboxItem.reasoningJson) as InboxReasoning;

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
        suggestedDepth={reasoning.suggestedDepth}
        suggestedAutonomy={reasoning.suggestedAutonomy}
      />
    </div>
  );
}
