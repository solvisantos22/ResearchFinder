import React from "react";
import { headers } from "next/headers";

import { PageShell } from "@/components/PageShell";
import { WorkerSetupContent } from "@/components/WorkerSetupContent";
import { getWorkersOverview, registerWorker } from "@/app/workers/actions";
import { getWorkersOverviewForUser } from "@/lib/workers/overview";
import { requireCurrentUser } from "@/lib/auth/session";
import { resolveWorkerSetupAppUrl } from "@/lib/jobs/worker-setup-url";

export default async function WorkersPage() {
  const currentUser = await requireCurrentUser();
  const [headerList, initialWorkers] = await Promise.all([
    headers(),
    getWorkersOverviewForUser(currentUser.id)
  ]);

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="workers"
    >
      <WorkerSetupContent
        appUrl={resolveWorkerSetupAppUrl(headerList)}
        registrationAction={registerWorker}
        registrationResult={null}
        initialWorkers={initialWorkers}
        overviewAction={getWorkersOverview}
      />
    </PageShell>
  );
}
