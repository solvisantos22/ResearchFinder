import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/app/api/cron/ingest/auth";
import { prisma } from "@/lib/db";
import { createInboxGenerationJob } from "@/lib/jobs/inbox-generation";
import { createArxivCandidateBatchForUser } from "@/lib/sources/arxiv-candidates";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isAuthorizedCronRequest(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inboxDate = todayIsoDate();
  const users = await prisma.user.findMany({
    where: { profile: { isNot: null } },
    select: { id: true }
  });

  const jobs = [];
  for (const user of users) {
    const batch = await createArxivCandidateBatchForUser(user.id, inboxDate);
    jobs.push(
      await createInboxGenerationJob({
        userId: user.id,
        candidateBatchId: batch.id,
        inboxDate
      })
    );
  }

  return NextResponse.json({ createdJobs: jobs.length });
}
