import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createWorkerToken, hashWorkerToken } from "@/lib/jobs/worker-auth";

export async function POST() {
  const currentUser = await requireCurrentUser();
  const token = createWorkerToken();
  const tokenHash = await hashWorkerToken(token);

  const worker = await prisma.workerRegistration.create({
    data: {
      userId: currentUser.id,
      label: `Worker ${new Date().toISOString()}`,
      tokenHash,
      status: "active"
    }
  });

  return NextResponse.json({
    workerId: worker.id,
    token
  });
}
