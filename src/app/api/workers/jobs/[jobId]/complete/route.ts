import { NextResponse } from "next/server";

import { findAllowedWorkerByToken } from "@/lib/auth/worker-token";
import { prisma } from "@/lib/db";
import { completeInboxGenerationJob } from "@/lib/jobs/inbox-generation";
import { completeNoveltyScanJob } from "@/lib/jobs/novelty-scan";
import { completeV2ViabilityJob } from "@/lib/jobs/viability";
import { readBearerToken } from "@/lib/jobs/worker-auth";
import { completeResearchStageJob, failResearchStageJob } from "@/lib/jobs/research";
import { recordWorkerJobLog } from "@/lib/workers/job-log";

type WorkerJobType =
  | "inbox_generation"
  | "novelty_scan"
  | "viability_check"
  | "research_plan"
  | "research_literature";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const worker = await findAllowedWorkerByToken(token);
  if (!worker) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.workerRegistration.update({
    where: { id: worker.id },
    data: { lastSeenAt: new Date() }
  });

  const { jobId } = await params;
  let body: { type?: unknown; output?: unknown; error?: unknown };

  try {
    body = (await request.json()) as { type?: unknown; output?: unknown; error?: unknown };
  } catch {
    const errorMessage = "Malformed worker completion request JSON";
    const jobType = await resolveJobType({
      requestedType: undefined,
      jobId,
      workerId: worker.id
    });

    if (jobType) {
      await markWorkerJobFailed({
        jobId,
        workerId: worker.id,
        jobType,
        errorMessage
      });
    }

    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const jobType = await resolveJobType({
    requestedType: body.type,
    jobId,
    workerId: worker.id
  });

  if (!jobType) {
    return NextResponse.json({ error: "Worker job is not claimable by this worker" }, { status: 404 });
  }

  const reportedError = readReportedWorkerError(body.error);
  if (reportedError) {
    await markWorkerJobFailed({
      jobId,
      workerId: worker.id,
      jobType,
      errorMessage: reportedError
    });

    return NextResponse.json({ ok: true });
  }

  try {
    if (jobType === "inbox_generation") {
      await completeInboxGenerationJob({
        jobId,
        workerId: worker.id,
        output: body.output
      });
    } else if (jobType === "novelty_scan") {
      await completeNoveltyScanJob({ jobId, workerId: worker.id, output: body.output });
    } else if (jobType === "viability_check") {
      await completeV2ViabilityJob({
        jobId,
        workerId: worker.id,
        output: body.output
      });
    } else {
      await completeResearchStageJob({ jobId, workerId: worker.id, output: body.output });
    }
  } catch (error) {
    const errorMessage = formatErrorMessage(error);
    await markWorkerJobFailed({
      jobId,
      workerId: worker.id,
      jobType,
      errorMessage
    });

    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  await recordWorkerJobLog({ workerId: worker.id, jobType, jobId, level: "completed" });

  return NextResponse.json({ ok: true });
}

async function markWorkerJobFailed(input: {
  jobId: string;
  workerId: string;
  jobType: WorkerJobType;
  errorMessage: string;
}) {
  const where = {
    id: input.jobId,
    claimedByWorkerId: input.workerId,
    status: "running"
  };
  const data = {
    status: "failed",
    errorMessage: input.errorMessage,
    completedAt: new Date()
  };

  if (input.jobType === "inbox_generation") {
    await prisma.inboxGenerationJob.updateMany({ where, data });
  } else if (input.jobType === "novelty_scan") {
    await prisma.inboxNoveltyScanJob.updateMany({ where, data });
  } else if (input.jobType === "research_plan" || input.jobType === "research_literature") {
    await failResearchStageJob({ jobId: input.jobId, errorMessage: input.errorMessage });
  } else {
    await prisma.viabilityJob.updateMany({ where, data });
  }

  await recordWorkerJobLog({
    workerId: input.workerId,
    jobType: input.jobType,
    jobId: input.jobId,
    level: "failed",
    errorMessage: input.errorMessage
  });
}

async function resolveJobType(input: {
  requestedType: unknown;
  jobId: string;
  workerId: string;
}): Promise<WorkerJobType | null> {
  const requestedType =
    input.requestedType === "inbox_generation" ||
    input.requestedType === "novelty_scan" ||
    input.requestedType === "viability_check" ||
    input.requestedType === "research_plan" ||
    input.requestedType === "research_literature"
      ? input.requestedType
      : null;

  const inboxJob = await prisma.inboxGenerationJob.findFirst({
    where: {
      id: input.jobId,
      claimedByWorkerId: input.workerId,
      status: "running"
    },
    select: { id: true }
  });

  if (inboxJob) {
    return requestedType && requestedType !== "inbox_generation" ? null : "inbox_generation";
  }

  const noveltyJob = await prisma.inboxNoveltyScanJob.findFirst({
    where: {
      id: input.jobId,
      claimedByWorkerId: input.workerId,
      status: "running"
    },
    select: { id: true }
  });

  if (noveltyJob) {
    return requestedType && requestedType !== "novelty_scan" ? null : "novelty_scan";
  }

  const viabilityJob = await prisma.viabilityJob.findFirst({
    where: {
      id: input.jobId,
      claimedByWorkerId: input.workerId,
      status: "running"
    },
    select: { id: true }
  });

  if (viabilityJob) {
    return requestedType && requestedType !== "viability_check" ? null : "viability_check";
  }

  const stageJob = await prisma.researchStageJob.findFirst({
    where: { id: input.jobId, claimedByWorkerId: input.workerId, status: "running" },
    select: { stageType: true }
  });

  if (!stageJob) return null;
  const stageJobType = `research_${stageJob.stageType}` as WorkerJobType;
  return requestedType && requestedType !== stageJobType ? null : stageJobType;
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown worker completion error";
}

function readReportedWorkerError(error: unknown) {
  if (typeof error !== "string") return null;

  const trimmed = error.trim();
  return trimmed.length > 0 ? trimmed : null;
}
