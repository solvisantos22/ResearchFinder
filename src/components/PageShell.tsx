import React from "react";
import type { Route } from "next";

import { AppShell } from "@/components/AppShell";
import { resolveWorkerStatusForUser } from "@/lib/workers/status";
import type { WorkerStatus } from "@/components/WorkerStatusPanel";

type PageShellProps = {
  currentUserId: string;
  currentUserName: string;
  activeSection: "inbox" | "profiles" | "jobs" | "workers";
  children: React.ReactNode;
};

function RightRail({ workerStatus }: { workerStatus: WorkerStatus }) {
  return (
    <div className="grid gap-3 text-sm text-rf-muted">
      <p className="text-xs font-semibold uppercase tracking-wide text-rf-muted">Worker</p>
      <p className="text-rf-white">Background AI execution runs on your local Codex worker.</p>
      <p>
        Status: <span className="font-semibold text-rf-white">{workerStatus.replace("_", " ")}</span>
      </p>
    </div>
  );
}

export async function PageShell({
  currentUserId,
  currentUserName,
  activeSection,
  children
}: PageShellProps) {
  const workerStatus = await resolveWorkerStatusForUser(currentUserId);
  const navItems = [
    { id: "inbox" as const, label: "Inbox", href: `/inbox/${currentUserId}` as Route },
    { id: "profiles" as const, label: "Profile", href: `/profiles/${currentUserId}` as Route },
    { id: "workers" as const, label: "Workers", href: "/workers" as Route }
  ];

  return (
    <AppShell
      currentUserName={currentUserName}
      workerStatus={workerStatus}
      activeSection={activeSection}
      navItems={navItems}
      rightRail={<RightRail workerStatus={workerStatus} />}
    >
      {children}
    </AppShell>
  );
}
