import { NextResponse } from "next/server";

import { findAllowedWorkerByToken } from "@/lib/auth/worker-token";
import { prisma } from "@/lib/db";
import { recordResearchStageHeartbeat } from "@/lib/jobs/research";
import { readBearerToken } from "@/lib/jobs/worker-auth";

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
  const result = await recordResearchStageHeartbeat({ jobId, workerId: worker.id });

  if (!result) {
    return NextResponse.json({ error: "Worker job is not running for this worker" }, { status: 404 });
  }

  return NextResponse.json(result);
}
