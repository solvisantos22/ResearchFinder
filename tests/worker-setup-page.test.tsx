import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  cookies: vi.fn(),
  createWorker: vi.fn(),
  createWorkerToken: vi.fn(),
  findWorkers: vi.fn(),
  hashWorkerToken: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
  requireCurrentUser: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({
  requireCurrentUser: mocked.requireCurrentUser
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    workerRegistration: {
      create: (...args: unknown[]) => mocked.createWorker(...args),
      findMany: (...args: unknown[]) => mocked.findWorkers(...args)
    }
  }
}));

vi.mock("@/lib/jobs/worker-auth", () => ({
  createWorkerToken: mocked.createWorkerToken,
  hashWorkerToken: mocked.hashWorkerToken
}));

vi.mock("next/headers", () => ({
  cookies: mocked.cookies,
  headers: mocked.headers
}));

vi.mock("next/navigation", () => ({
  redirect: mocked.redirect
}));

import { WorkerSetupContent } from "@/components/WorkerSetupContent";
import { registerWorker } from "@/app/workers/actions";
import WorkersPage from "@/app/workers/page";

describe("WorkerSetupContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.headers.mockResolvedValue(
      new Headers({
        host: "research.example.com",
        "x-forwarded-proto": "https"
      })
    );
    mocked.cookies.mockResolvedValue({
      get: vi.fn(),
      set: vi.fn()
    });
    mocked.requireCurrentUser.mockResolvedValue({ id: "user-1" });
    mocked.createWorker.mockResolvedValue({ id: "worker-1" });
    mocked.createWorkerToken.mockReturnValue("plain-worker-token");
    mocked.findWorkers.mockResolvedValue([]);
    mocked.hashWorkerToken.mockResolvedValue("hashed-worker-token");
  });

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

  it("does not render a setup command without an action result token", () => {
    render(
      <WorkerSetupContent
        appUrl="https://research.example.com"
        registrationAction={vi.fn()}
        registrationResult={null}
        workers={[]}
      />
    );

    expect(screen.getByText("Register a worker to reveal the one-time setup command.")).toBeInTheDocument();
    expect(screen.queryByText(/-WorkerToken/)).not.toBeInTheDocument();
  });

  it("does not reveal a worker token from GET page state", async () => {
    mocked.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "cookie-worker-token" }),
      set: vi.fn()
    });

    render(await WorkersPage());

    expect(screen.getByText("Register a worker to reveal the one-time setup command.")).toBeInTheDocument();
    expect(screen.queryByText(/cookie-worker-token/)).not.toBeInTheDocument();
  });

  it("creates an active worker registration and returns the token as the action result", async () => {
    const cookieStore = {
      get: vi.fn(),
      set: vi.fn()
    };
    mocked.cookies.mockResolvedValue(cookieStore);

    await expect(registerWorker(null)).resolves.toEqual({ token: "plain-worker-token" });

    expect(mocked.createWorker).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        label: "Local Codex worker",
        tokenHash: "hashed-worker-token",
        status: "active"
      },
      select: { id: true }
    });
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(mocked.redirect).not.toHaveBeenCalled();
  });
});
