import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { claimNextInboxGenerationJob } from "@/lib/jobs/inbox-generation";
import { readBearerToken, verifyWorkerToken } from "@/lib/jobs/worker-auth";
import { MAX_DAILY_IDEAS, MAX_IDEAS_PER_PAPER } from "@/lib/v2/domain";
import {
  type InboxGenerationJobInput,
  InboxGenerationJobInputSchema
} from "@/lib/v2/schemas";

export async function POST(request: Request) {
  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const worker = await findWorkerByToken(token);
  if (!worker) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.workerRegistration.update({
    where: { id: worker.id },
    data: { lastSeenAt: new Date() }
  });

  const job = await claimNextInboxGenerationJob({
    userId: worker.userId,
    workerId: worker.id
  });

  if (!job) {
    return NextResponse.json({ job: null });
  }

  let input: InboxGenerationJobInput;

  try {
    if (!job.user.profile) {
      throw new Error("Worker user has no research profile");
    }

    input = InboxGenerationJobInputSchema.parse({
      jobId: job.id,
      userId: job.userId,
      inboxDate: job.inboxDate,
      profile: {
        fieldPreset: job.user.profile.fieldPresetKey,
        keywords: parseJsonArray(job.user.profile.keywordsJson),
        constraints: parseJsonArray(job.user.profile.constraintsJson),
        preferredOutputs: parseJsonArray(job.user.profile.preferredOutputsJson),
        arxivQuery: job.user.profile.arxivQuery,
        maxIdeas: MAX_DAILY_IDEAS,
        maxIdeasPerPaper: MAX_IDEAS_PER_PAPER
      },
      candidatePapers: job.candidateBatch.candidates.map((candidate) => ({
        sourceId: candidate.arxivId,
        title: candidate.title,
        abstract: candidate.abstract,
        url: candidate.url,
        authors: parseJsonArray(candidate.authorsJson),
        categories: parseJsonArray(candidate.categoriesJson),
        publishedAt: candidate.publishedAt.toISOString()
      }))
    });
  } catch (error) {
    await prisma.inboxGenerationJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: formatErrorMessage(error),
        completedAt: new Date()
      }
    });

    return NextResponse.json(
      { error: "Claimed job payload could not be built" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    job: {
      type: "inbox_generation",
      id: job.id,
      input
    }
  });
}

async function findWorkerByToken(token: string) {
  const workers = await prisma.workerRegistration.findMany({
    where: {
      status: "active",
      revokedAt: null
    },
    select: {
      id: true,
      userId: true,
      tokenHash: true
    }
  });

  for (const worker of workers) {
    if (await verifyWorkerToken(token, worker.tokenHash)) {
      return worker;
    }
  }

  return null;
}

function parseJsonArray(json: string) {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value : [];
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown worker payload error";
}
