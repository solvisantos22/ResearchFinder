import React from "react";
import { notFound } from "next/navigation";

import { PaperCard } from "@/components/PaperCard";
import { canViewUserResearch } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getInboxItems } from "@/lib/inbox/service";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function InboxPage({ params }: { params: Promise<{ userId: string }> }) {
  const currentUser = await requireCurrentUser();
  const { userId } = await params;

  if (!canViewUserResearch({ currentUserId: currentUser.id, targetUserId: userId })) {
    notFound();
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    notFound();
  }

  const inboxDate = todayIsoDate();
  const items = await getInboxItems(userId, inboxDate);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Morning inbox
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">
          {user.name}&apos;s research inbox
        </h1>
        <p className="mt-2 text-slate-600">
          Papers ranked by paper quality, project opportunity, and dispatch likelihood.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8">
          <h2 className="text-xl font-semibold text-slate-900">No inbox items yet</h2>
          <p className="mt-2 text-slate-600">
            Run <code>npm run db:seed</code> and <code>npm run ingest:daily</code> to create
            today&apos;s personalized inbox.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <PaperCard key={item.id} item={item} />
          ))}
        </div>
      )}
      </div>
    </main>
  );
}
