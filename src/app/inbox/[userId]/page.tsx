import React, { type ComponentProps } from "react";
import { notFound } from "next/navigation";

import { InboxDateNav } from "@/components/InboxDateNav";
import { PageShell } from "@/components/PageShell";
import { PaperIdeaGroup } from "@/components/PaperIdeaGroup";
import { canViewUserResearch } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getGeneratedInboxState, listInboxDatesForUser } from "@/lib/jobs/inbox-generation";

type GeneratedInboxIdea = Awaited<ReturnType<typeof getGeneratedInboxState>>["ideas"][number];
type PaperGroup = {
  id: string;
  paper: ComponentProps<typeof PaperIdeaGroup>["paper"];
  ideas: ComponentProps<typeof PaperIdeaGroup>["ideas"];
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseScoreExplanations(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

function groupIdeasByPaper(ideas: GeneratedInboxIdea[]): PaperGroup[] {
  const groups = new Map<string, PaperGroup>();

  for (const idea of ideas) {
    const existingGroup = groups.get(idea.paperId);
    const group =
      existingGroup ??
      {
        id: idea.paperId,
        paper: {
          title: idea.paper.title,
          abstract: idea.paper.abstract,
          url: idea.paper.url,
          authors: parseStringArray(idea.paper.authorsJson),
          categories: parseStringArray(idea.paper.categoriesJson),
          publishedAt: idea.paper.publishedAt.toISOString().slice(0, 10)
        },
        ideas: []
      };

    const latestNoveltyScan = idea.noveltyScans[0] ?? null;

    group.ideas.push({
      id: idea.id,
      title: idea.title,
      summary: idea.summary,
      expandedExplanation: idea.expandedExplanation,
      trajectory: idea.trajectory,
      noveltyStatus: idea.noveltyStatus,
      overallScore: idea.overallScore,
      scoreExplanations: parseScoreExplanations(idea.scoreExplanationsJson),
      noveltyScan: latestNoveltyScan
        ? {
            label: latestNoveltyScan.label,
            confidence: latestNoveltyScan.confidence,
            summary: latestNoveltyScan.summary,
            overlapExplanation: latestNoveltyScan.overlapExplanation,
            evidence: latestNoveltyScan.evidence.map((evidence) => ({
              title: evidence.title,
              url: evidence.url,
              sourceType: evidence.sourceType,
              overlapLevel: evidence.overlapLevel,
              confidence: evidence.confidence
            }))
          }
        : null
    });

    if (!existingGroup) {
      groups.set(idea.paperId, group);
    }
  }

  return Array.from(groups.values());
}

function StatusCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-rf-border bg-rf-panel p-8">
      <h2 className="text-xl font-semibold text-rf-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-rf-muted">{children}</p>
    </div>
  );
}

function renderInboxStatus(status: string, inboxDate: string) {
  switch (status) {
    case "pending":
      return (
        <StatusCard title="AI inbox pending">
          No AI inbox generation has started for {inboxDate} yet. The next scheduled worker cycle can
          queue it.
        </StatusCard>
      );
    case "queued":
      return (
        <StatusCard title="AI inbox queued">
          Your AI inbox generation is queued for {inboxDate} and waiting for an available worker.
        </StatusCard>
      );
    case "running":
      return (
        <StatusCard title="AI inbox running">
          Your AI inbox is being generated now. Refresh this page shortly to see the ranked ideas.
        </StatusCard>
      );
    case "failed":
      return (
        <StatusCard title="AI inbox generation failed">
          Generation failed for {inboxDate}. It can be retried later from the hosted worker flow.
        </StatusCard>
      );
    case "timed_out":
      return (
        <StatusCard title="AI inbox timed out">
          Generation took longer than expected for {inboxDate}. It can be retried later.
        </StatusCard>
      );
    case "superseded":
      return (
        <StatusCard title="Day skipped">
          Your worker was offline when {inboxDate} was scheduled, so it was skipped to keep your
          inbox current. Only the latest day is generated when your worker reconnects.
        </StatusCard>
      );
    case "completed":
      return (
        <StatusCard title="No generated ideas yet">
          AI inbox generation completed for {inboxDate}, but it did not return any ideas. Future
          candidate batches may produce new results.
        </StatusCard>
      );
    case "ready":
      return (
        <StatusCard title="No generated ideas yet">
          AI inbox generation is ready for {inboxDate}, but there are no generated ideas to show yet.
        </StatusCard>
      );
    default:
      return (
        <StatusCard title="AI inbox unavailable">
          The AI inbox state for {inboxDate} is not available right now.
        </StatusCard>
      );
  }
}

export default async function InboxPage({
  params,
  searchParams
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<{ date?: string | string[] }>;
}) {
  const currentUser = await requireCurrentUser();
  const { userId } = await params;

  if (!canViewUserResearch({ currentUserId: currentUser.id, targetUserId: userId })) {
    notFound();
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    notFound();
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedDateRaw = resolvedSearchParams.date;
  const requestedDate = Array.isArray(requestedDateRaw) ? requestedDateRaw[0] : requestedDateRaw;

  const availableDates = await listInboxDatesForUser(userId);
  const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  const inboxDate =
    requestedDate && isIsoDate(requestedDate)
      ? requestedDate
      : availableDates[0] ?? todayIsoDate();

  const inboxState = await getGeneratedInboxState(userId, inboxDate);
  const paperGroups = groupIdeasByPaper(inboxState.ideas);
  const displayName = user.name?.trim() || "Researcher";

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="inbox"
    >
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-rf-muted">
              AI research inbox
            </p>
            <h1 className="text-3xl font-semibold text-rf-white">
              {displayName}&apos;s generated research inbox
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-rf-muted">
              Showing the inbox for {inboxDate}. Each day is its own set of papers and ideas.
            </p>
          </div>
          <InboxDateNav userId={userId} currentDate={inboxDate} availableDates={availableDates} />
        </header>

        {inboxState.status === "ready" && paperGroups.length > 0 ? (
          <div className="grid gap-4">
            {paperGroups.map((group) => (
              <PaperIdeaGroup
                key={group.id}
                currentUserId={currentUser.id}
                generatedForUserId={userId}
                paper={group.paper}
                ideas={group.ideas}
                enableDispatch
              />
            ))}
          </div>
        ) : (
          renderInboxStatus(inboxState.status, inboxDate)
        )}
      </div>
    </PageShell>
  );
}
