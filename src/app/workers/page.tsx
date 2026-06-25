import React from "react";
import { headers } from "next/headers";

import { PageShell } from "@/components/PageShell";
import { WorkerSetupContent } from "@/components/WorkerSetupContent";
import { getCurrentWorkerStatus, registerWorker } from "@/app/workers/actions";
import { resolveWorkerStatusForUser } from "@/lib/workers/status";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { resolveWorkerSetupAppUrl } from "@/lib/jobs/worker-setup-url";

export default async function WorkersPage() {
  const currentUser = await requireCurrentUser();
  const [headerList, workers, workerStatus] = await Promise.all([
    headers(),
    prisma.workerRegistration.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        revokedAt: true
      }
    }),
    resolveWorkerStatusForUser(currentUser.id)
  ]);

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="workers"
    >
      <WorkerSetupContent
        appUrl={resolveWorkerSetupAppUrl(headerList)}
        workers={workers}
        registrationAction={registerWorker}
        registrationResult={null}
        initialWorkerStatus={workerStatus}
        statusAction={getCurrentWorkerStatus}
      />
    </PageShell>
  );
}
