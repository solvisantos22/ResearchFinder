import React from "react";
import { headers } from "next/headers";

import { PageShell } from "@/components/PageShell";
import { WorkerSetupContent } from "@/components/WorkerSetupContent";
import { LauncherPanel } from "@/components/LauncherPanel";
import { getWorkersOverview, registerWorker, getLauncherOverview, registerLauncher, setLaneDesiredAction } from "@/app/workers/actions";
import { getWorkersOverviewForUser } from "@/lib/workers/overview";
import { requireCurrentUser } from "@/lib/auth/session";
import { resolveWorkerSetupAppUrl } from "@/lib/jobs/worker-setup-url";

export default async function WorkersPage() {
  const currentUser = await requireCurrentUser();
  const [headerList, initialWorkers, launcherOverview] = await Promise.all([
    headers(),
    getWorkersOverviewForUser(currentUser.id),
    getLauncherOverview()
  ]);

  const appUrl = resolveWorkerSetupAppUrl(headerList);

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="workers"
    >
      <div className="mx-auto max-w-5xl px-6 pt-8">
        <LauncherPanel
          appUrl={appUrl}
          initialStatus={launcherOverview.status}
          initialDesired={launcherOverview.desired}
          registerLauncherAction={registerLauncher}
          setLaneDesiredAction={setLaneDesiredAction}
        />
      </div>
      <WorkerSetupContent
        appUrl={appUrl}
        registrationAction={registerWorker}
        registrationResult={null}
        initialWorkers={initialWorkers}
        overviewAction={getWorkersOverview}
      />
    </PageShell>
  );
}
