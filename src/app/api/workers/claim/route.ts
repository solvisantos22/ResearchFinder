import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { claimNextInboxGenerationJob } from "@/lib/jobs/inbox-generation";
import { claimNextViabilityJob } from "@/lib/jobs/viability";
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
    const viabilityJob = await claimNextViabilityJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (!viabilityJob) {
      return NextResponse.json({ job: null });
    }

    try {
      return NextResponse.json({
        job: {
          type: "viability_check",
          id: viabilityJob.id,
          input: buildViabilityJobInput(viabilityJob)
        }
      });
    } catch (error) {
      await prisma.viabilityJob.update({
        where: { id: viabilityJob.id },
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
        keywords: parseJsonArray(job.user.profile.keywordsJson, "keywordsJson"),
        constraints: parseJsonArray(job.user.profile.constraintsJson, "constraintsJson"),
        preferredOutputs: parseJsonArray(
          job.user.profile.preferredOutputsJson,
          "preferredOutputsJson"
        ),
        arxivQuery: job.user.profile.arxivQuery,
        maxIdeas: MAX_DAILY_IDEAS,
        maxIdeasPerPaper: MAX_IDEAS_PER_PAPER
      },
      candidatePapers: job.candidateBatch.candidates.map((candidate) => ({
        sourceId: candidate.arxivId,
        title: candidate.title,
        abstract: candidate.abstract,
        url: candidate.url,
        authors: parseJsonArray(candidate.authorsJson, "authorsJson"),
        categories: parseJsonArray(candidate.categoriesJson, "categoriesJson"),
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

function parseJsonArray(json: string, fieldName: string) {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }

  return value;
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown worker payload error";
}

type ClaimedViabilityJob = NonNullable<Awaited<ReturnType<typeof claimNextViabilityJob>>>;

function buildViabilityJobInput(job: ClaimedViabilityJob) {
  const sourceIdea = job.generatedIdea ?? job.idea;

  if (!sourceIdea) {
    throw new Error("Viability job is missing an idea reference");
  }

  return {
    jobId: job.id,
    userId: job.userId,
    sprintDepth: job.sprintDepth,
    autonomyLevel: job.autonomyLevel,
    idea: {
      id: sourceIdea.id,
      source: job.generatedIdea ? "generated_inbox" : "legacy_inbox",
      title: sourceIdea.title,
      summary: sourceIdea.summary,
      details:
        "expandedExplanation" in sourceIdea
          ? sourceIdea.expandedExplanation
          : sourceIdea.rationale,
      smallestSprint:
        "smallestSprint" in sourceIdea ? sourceIdea.smallestSprint : sourceIdea.approach
    },
    paper: {
      id: sourceIdea.paper.id,
      title: sourceIdea.paper.title,
      abstract: sourceIdea.paper.abstract,
      url: sourceIdea.paper.url,
      authors: parseJsonArray(sourceIdea.paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(sourceIdea.paper.categoriesJson, "categoriesJson"),
      publishedAt: sourceIdea.paper.publishedAt.toISOString()
    },
    citations:
      "citations" in sourceIdea
        ? sourceIdea.citations.map((citation) => ({
            sourceType: citation.sourceType,
            title: citation.title,
            url: citation.url,
            sourceId: citation.sourceId,
            claim: citation.claim,
            confidence: citation.confidence
          }))
        : []
  };
}
