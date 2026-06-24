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
  const failedUsers = [];
  const skippedUsers = [];
  for (const user of users) {
    try {
      const batch = await createArxivCandidateBatchForUser(user.id, inboxDate);
      if (Array.isArray(batch.candidates) && batch.candidates.length === 0) {
        skippedUsers.push({
          userId: user.id,
          reason: "No arXiv candidates"
        });
        continue;
      }

      jobs.push(
        await createInboxGenerationJob({
          userId: user.id,
          candidateBatchId: batch.id,
          inboxDate
        })
      );
    } catch (error) {
      failedUsers.push({
        userId: user.id,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  const response =
    skippedUsers.length > 0
      ? { createdJobs: jobs.length, skippedUsers, failedUsers }
      : { createdJobs: jobs.length, failedUsers };
  const allUsersFailed = users.length > 0 && failedUsers.length === users.length;

  return NextResponse.json(response, { status: allUsersFailed ? 500 : 200 });
}
