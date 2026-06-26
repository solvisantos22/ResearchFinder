import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkersOverviewLive } from "@/components/WorkersOverviewLive";
import type { WorkerOverviewRow } from "@/lib/workers/overview";

function row(overrides: Partial<WorkerOverviewRow>): WorkerOverviewRow {
  return {
    id: "w1", label: "Codex worker", lane: "research", status: "online",
    lastSeenAt: new Date(), createdAt: new Date(), currentJobs: [], recentLogs: [],
    ...overrides
  };
}

describe("WorkersOverviewLive", () => {
  it("renders each worker with its lane and current job", () => {
    const initial: WorkerOverviewRow[] = [
      row({
        id: "w1", label: "Codex worker", lane: "research", status: "online",
        currentJobs: [{ jobType: "research_plan", jobId: "j1", targetLabel: "ProbeCraft", startedAt: new Date() }]
      }),
      row({ id: "w2", label: "Inbox worker", lane: "inbox", status: "online", currentJobs: [] })
    ];
    render(<WorkersOverviewLive initialWorkers={initial} overviewAction={vi.fn()} />);

    expect(screen.getByText("Codex worker")).toBeInTheDocument();
    expect(screen.getByText("Inbox worker")).toBeInTheDocument();
    expect(screen.getByText("ProbeCraft")).toBeInTheDocument();
    expect(screen.getByText(/research_plan/)).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("shows an empty state when there are no workers", () => {
    render(<WorkersOverviewLive initialWorkers={[]} overviewAction={vi.fn()} />);
    expect(screen.getByText(/No workers registered/i)).toBeInTheDocument();
  });
});
