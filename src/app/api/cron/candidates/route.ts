import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/app/api/cron/ingest/auth";
import { isAllowedGoogleEmail } from "@/lib/auth/allowed-emails";
import { prisma } from "@/lib/db";
import { createInboxGenerationJob } from "@/lib/jobs/inbox-generation";
import { createArxivCandidateBatchForUser } from "@/lib/sources/arxiv-candidates";

export const dynamic = "force-dynamic";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// Vercel cron triggers this path with a GET (and attaches `Authorization: Bearer
// $CRON_SECRET`); the manual curl uses POST. Both run the same fetch.
export async function GET(request: Request) {
  return runCandidateFetch(request);
}

export async function POST(request: Request) {
  return runCandidateFetch(request);
}

async function runCandidateFetch(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isAuthorizedCronRequest(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inboxDate = todayIsoDate();
  const users = await prisma.user.findMany({
    where: { profile: { isNot: null } },
    select: { id: true, email: true }
  });
  const allowedUsers = users.filter((user) => isAllowedGoogleEmail(user.email));

  const jobs = [];
  const failedUsers = [];
  const skippedUsers = [];
  for (const user of allowedUsers) {
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
  const allUsersFailed = allowedUsers.length > 0 && failedUsers.length === allowedUsers.length;

  return NextResponse.json(response, { status: allUsersFailed ? 500 : 200 });
}
