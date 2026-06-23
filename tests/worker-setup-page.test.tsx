import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkerSetupContent } from "@/app/workers/page";

describe("WorkerSetupContent", () => {
  it("renders setup command and current worker status", () => {
    render(
      <WorkerSetupContent
        appUrl="https://research.example.com"
        registrationAction={vi.fn()}
        registrationResult={{ token: "plain-worker-token" }}
        workers={[
          {
            id: "worker-1",
            label: "Local Codex worker",
            status: "active",
            lastSeenAt: new Date("2026-06-23T10:15:00.000Z"),
            createdAt: new Date("2026-06-22T09:00:00.000Z"),
            revokedAt: null
          }
        ]}
      />
    );

    expect(screen.getByText("Connect my Codex worker")).toBeInTheDocument();
    expect(screen.getByText("PowerShell setup command")).toBeInTheDocument();
    expect(screen.getByText("Current worker status")).toBeInTheDocument();
    expect(screen.getByText("Last seen timestamp")).toBeInTheDocument();
    expect(
      screen.getByText(
        'powershell -ExecutionPolicy Bypass -File scripts/install-worker.ps1 -AppUrl "https://research.example.com" -WorkerToken "plain-worker-token"'
      )
    ).toBeInTheDocument();
  });
});
