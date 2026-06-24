import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { completeInboxGenerationJob } from "@/lib/jobs/inbox-generation";
import { completeV2ViabilityJob } from "@/lib/jobs/viability";
import { readBearerToken, verifyWorkerToken } from "@/lib/jobs/worker-auth";

type WorkerJobType = "inbox_generation" | "viability_check";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
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

  const { jobId } = await params;
  let body: { type?: unknown; output?: unknown };

  try {
    body = (await request.json()) as { type?: unknown; output?: unknown };
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

  try {
    if (jobType === "inbox_generation") {
      await completeInboxGenerationJob({
        jobId,
        workerId: worker.id,
        output: body.output
      });
    } else {
      await completeV2ViabilityJob({
        jobId,
        workerId: worker.id,
        output: body.output
      });
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
    return;
  }

  await prisma.viabilityJob.updateMany({ where, data });
}

async function resolveJobType(input: {
  requestedType: unknown;
  jobId: string;
  workerId: string;
}): Promise<WorkerJobType | null> {
  const requestedType =
    input.requestedType === "inbox_generation" || input.requestedType === "viability_check"
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

  const viabilityJob = await prisma.viabilityJob.findFirst({
    where: {
      id: input.jobId,
      claimedByWorkerId: input.workerId,
      status: "running"
    },
    select: { id: true }
  });

  if (!viabilityJob) return null;
  return requestedType && requestedType !== "viability_check" ? null : "viability_check";
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

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown worker completion error";
}
