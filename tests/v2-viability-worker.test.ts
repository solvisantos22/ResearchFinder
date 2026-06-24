import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  artifactCreate: vi.fn(),
  evidenceCreateMany: vi.fn(),
  inboxFindFirst: vi.fn(),
  inboxUpdateMany: vi.fn(),
  routeCompleteInbox: vi.fn(),
  routeCompleteViability: vi.fn(),
  routeFindWorkers: vi.fn(),
  routeReadBearerToken: vi.fn(),
  routeUpdateWorker: vi.fn(),
  routeVerifyWorkerToken: vi.fn(),
  transaction: vi.fn(),
  viabilityFindFirst: vi.fn(),
  viabilityFindFirstOrThrow: vi.fn(),
  viabilityFindUniqueOrThrow: vi.fn(),
  viabilityUpdate: vi.fn(),
  viabilityUpdateMany: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mocked.transaction(...args),
    artifact: {
      create: (...args: unknown[]) => mocked.artifactCreate(...args)
    },
    evidence: {
      createMany: (...args: unknown[]) => mocked.evidenceCreateMany(...args)
    },
    inboxGenerationJob: {
      findFirst: (...args: unknown[]) => mocked.inboxFindFirst(...args),
      updateMany: (...args: unknown[]) => mocked.inboxUpdateMany(...args)
    },
    viabilityJob: {
      findFirst: (...args: unknown[]) => mocked.viabilityFindFirst(...args),
      findFirstOrThrow: (...args: unknown[]) => mocked.viabilityFindFirstOrThrow(...args),
      findUniqueOrThrow: (...args: unknown[]) => mocked.viabilityFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mocked.viabilityUpdate(...args),
      updateMany: (...args: unknown[]) => mocked.viabilityUpdateMany(...args)
    },
    workerRegistration: {
      findMany: (...args: unknown[]) => mocked.routeFindWorkers(...args),
      update: (...args: unknown[]) => mocked.routeUpdateWorker(...args)
    }
  }
}));

vi.mock("@/lib/jobs/inbox-generation", () => ({
  completeInboxGenerationJob: (...args: unknown[]) => mocked.routeCompleteInbox(...args)
}));

vi.mock("@/lib/jobs/worker-auth", () => ({
  readBearerToken: (...args: unknown[]) => mocked.routeReadBearerToken(...args),
  verifyWorkerToken: (...args: unknown[]) => mocked.routeVerifyWorkerToken(...args)
}));

const servicePromise = import("@/lib/jobs/viability");

afterEach(() => {
  vi.useRealTimers();
  for (const mock of Object.values(mocked)) {
    mock.mockReset();
  }
});

function createViabilityOutput(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "viability-job-1",
    verdict: "expand",
    summary: "The idea is viable enough to expand.",
    feasibility: "A small evaluation slice can be built in one sprint.",
    noveltyRisk: "Related work still needs a focused check.",
    minimumExperiment: "Build 20 examples and compare two baselines.",
    blockers: ["Confirm dataset licensing."],
    citations: [
      {
        sourceType: "paper",
        title: "Source paper",
        url: "https://arxiv.org/abs/2606.00001",
        sourceId: "2606.00001",
        claim: "The paper supports the project framing.",
        confidence: 0.92
      }
    ],
    ...overrides
  };
}

function createCompletionTransaction(updateCount: number) {
  return {
    artifact: {
      create: vi.fn().mockResolvedValue({})
    },
    evidence: {
      createMany: vi.fn().mockResolvedValue({})
    },
    viabilityJob: {
      updateMany: vi.fn().mockResolvedValue({ count: updateCount })
    }
  };
}

describe("claimNextViabilityJob", () => {
  it("claims the oldest queued viability job owned by the worker user", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T12:00:00.000Z"));
    mocked.viabilityFindFirst.mockResolvedValue({ id: "older-job" });
    mocked.viabilityUpdateMany.mockResolvedValue({ count: 1 });
    mocked.viabilityFindUniqueOrThrow.mockResolvedValue({
      id: "older-job",
      status: "running",
      claimedByWorkerId: "worker-1"
    });

    const { claimNextViabilityJob } = await servicePromise;
    const claimed = await claimNextViabilityJob({
      userId: "user-1",
      workerId: "worker-1"
    });

    expect(claimed).toEqual({
      id: "older-job",
      status: "running",
      claimedByWorkerId: "worker-1"
    });
    expect(mocked.viabilityFindFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: new Date("2026-06-23T11:30:00.000Z") } }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    expect(mocked.viabilityUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "older-job",
        userId: "user-1",
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: new Date("2026-06-23T11:30:00.000Z") } }
        ]
      },
      data: {
        status: "running",
        claimedByWorkerId: "worker-1",
        startedAt: new Date("2026-06-23T12:00:00.000Z"),
        completedAt: null,
        errorMessage: null
      }
    });
  });

  it("reclaims a running viability job after the stale timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T12:00:00.000Z"));
    mocked.viabilityFindFirst.mockResolvedValue({ id: "stale-viability-job" });
    mocked.viabilityUpdateMany.mockResolvedValue({ count: 1 });
    mocked.viabilityFindUniqueOrThrow.mockResolvedValue({
      id: "stale-viability-job",
      status: "running",
      claimedByWorkerId: "worker-2"
    });

    const { claimNextViabilityJob } = await servicePromise;
    const claimed = await claimNextViabilityJob({
      userId: "user-1",
      workerId: "worker-2"
    });

    expect(claimed).toEqual({
      id: "stale-viability-job",
      status: "running",
      claimedByWorkerId: "worker-2"
    });
    expect(mocked.viabilityUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "stale-viability-job",
        userId: "user-1",
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: new Date("2026-06-23T11:30:00.000Z") } }
        ]
      },
      data: {
        status: "running",
        claimedByWorkerId: "worker-2",
        startedAt: new Date("2026-06-23T12:00:00.000Z"),
        completedAt: null,
        errorMessage: null
      }
    });
  });
});

describe("completeV2ViabilityJob", () => {
  it("validates worker upload with ViabilityResultSchema before persisting", async () => {
    const { completeV2ViabilityJob } = await servicePromise;

    await expect(
      completeV2ViabilityJob({
        jobId: "viability-job-1",
        workerId: "worker-1",
        output: createViabilityOutput({ verdict: "maybe" })
      })
    ).rejects.toThrow();

    expect(mocked.viabilityFindFirstOrThrow).not.toHaveBeenCalled();
    expect(mocked.transaction).not.toHaveBeenCalled();
  });

  it("persists allowed verdicts, report artifact, and citations as Evidence rows", async () => {
    const tx = createCompletionTransaction(1);
    mocked.transaction.mockImplementation(
      async (run: (transactionClient: typeof tx) => Promise<unknown>) => run(tx)
    );

    const { completeV2ViabilityJob } = await servicePromise;

    for (const verdict of ["expand", "needs_novelty_check", "revise", "reject"]) {
      await completeV2ViabilityJob({
        jobId: "viability-job-1",
        workerId: "worker-1",
        output: createViabilityOutput({ verdict })
      });
    }

    expect(tx.viabilityJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: "viability-job-1",
        claimedByWorkerId: "worker-1",
        status: "running"
      },
      data: {
        status: "completed",
        verdict: "expand",
        completedAt: expect.any(Date)
      }
    });
    expect(tx.evidence.createMany).toHaveBeenCalledWith({
      data: [
        {
          jobId: "viability-job-1",
          sourceTitle: "Source paper",
          sourceUrl: "https://arxiv.org/abs/2606.00001",
          claim: "The paper supports the project framing.",
          support: "The idea is viable enough to expand.",
          confidence: 0.92
        }
      ]
    });
    expect(tx.artifact.create).toHaveBeenCalledWith({
      data: {
        jobId: "viability-job-1",
        kind: "viability-report",
        title: "Viability result: expand",
        content: expect.any(String)
      }
    });
    expect(JSON.parse(tx.artifact.create.mock.calls[0]?.[0].data.content)).toEqual(
      createViabilityOutput({ verdict: "expand" })
    );
  });

  it("requires the completing worker to be the worker that claimed the job", async () => {
    const tx = createCompletionTransaction(0);
    mocked.transaction.mockImplementation(
      async (run: (transactionClient: typeof tx) => Promise<unknown>) => run(tx)
    );

    const { completeV2ViabilityJob } = await servicePromise;

    await expect(
      completeV2ViabilityJob({
        jobId: "viability-job-1",
        workerId: "worker-2",
        output: createViabilityOutput()
      })
    ).rejects.toThrow("Viability job is no longer running");

    expect(tx.viabilityJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: "viability-job-1",
        claimedByWorkerId: "worker-2",
        status: "running"
      },
      data: {
        status: "completed",
        verdict: "expand",
        completedAt: expect.any(Date)
      }
    });
    expect(tx.evidence.createMany).not.toHaveBeenCalled();
    expect(tx.artifact.create).not.toHaveBeenCalled();
  });

  it("does not create evidence or artifacts when the guarded completion update is stale", async () => {
    const tx = createCompletionTransaction(0);
    mocked.transaction.mockImplementation(
      async (run: (transactionClient: typeof tx) => Promise<unknown>) => run(tx)
    );

    const { completeV2ViabilityJob } = await servicePromise;

    await expect(
      completeV2ViabilityJob({
        jobId: "viability-job-1",
        workerId: "worker-1",
        output: createViabilityOutput()
      })
    ).rejects.toThrow("Viability job is no longer running");

    expect(tx.viabilityJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: "viability-job-1",
        claimedByWorkerId: "worker-1",
        status: "running"
      },
      data: {
        status: "completed",
        verdict: "expand",
        completedAt: expect.any(Date)
      }
    });
    expect(tx.evidence.createMany).not.toHaveBeenCalled();
    expect(tx.artifact.create).not.toHaveBeenCalled();
    expect(mocked.evidenceCreateMany).not.toHaveBeenCalled();
    expect(mocked.artifactCreate).not.toHaveBeenCalled();
  });
});

describe("worker completion route", () => {
  it("routes viability_check completion to the v2 viability completer", async () => {
    mocked.routeReadBearerToken.mockReturnValue("worker-token");
    mocked.routeFindWorkers.mockResolvedValue([
      { id: "worker-1", userId: "user-1", tokenHash: "stored-hash" }
    ]);
    mocked.routeVerifyWorkerToken.mockResolvedValue(true);
    mocked.routeUpdateWorker.mockResolvedValue({});
    mocked.routeCompleteViability.mockResolvedValue({});
    mocked.inboxFindFirst.mockResolvedValue(null);
    mocked.viabilityFindFirst.mockResolvedValue({ id: "viability-job-1" });

    vi.doMock("@/lib/jobs/viability", () => ({
      claimNextViabilityJob: vi.fn(),
      completeV2ViabilityJob: (...args: unknown[]) => mocked.routeCompleteViability(...args),
      createV2ViabilityJob: vi.fn()
    }));
    vi.resetModules();
    const { POST } = await import("@/app/api/workers/jobs/[jobId]/complete/route");

    const response = await POST(
      new Request("https://example.com/api/workers/jobs/viability-job-1/complete", {
        method: "POST",
        body: JSON.stringify({
          type: "viability_check",
          output: createViabilityOutput()
        })
      }),
      { params: Promise.resolve({ jobId: "viability-job-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocked.routeCompleteViability).toHaveBeenCalledWith({
      jobId: "viability-job-1",
      workerId: "worker-1",
      output: createViabilityOutput()
    });
    expect(mocked.routeCompleteInbox).not.toHaveBeenCalled();
  });

  it("rejects completion when the requested job type does not match the claimed database job", async () => {
    mocked.routeReadBearerToken.mockReturnValue("worker-token");
    mocked.routeFindWorkers.mockResolvedValue([
      { id: "worker-1", userId: "user-1", tokenHash: "stored-hash" }
    ]);
    mocked.routeVerifyWorkerToken.mockResolvedValue(true);
    mocked.routeUpdateWorker.mockResolvedValue({});
    mocked.inboxFindFirst.mockResolvedValue(null);
    mocked.viabilityFindFirst.mockResolvedValue({ id: "viability-job-1" });

    vi.doMock("@/lib/jobs/viability", () => ({
      claimNextViabilityJob: vi.fn(),
      completeV2ViabilityJob: (...args: unknown[]) => mocked.routeCompleteViability(...args),
      createV2ViabilityJob: vi.fn()
    }));
    vi.resetModules();
    const { POST } = await import("@/app/api/workers/jobs/[jobId]/complete/route");

    const response = await POST(
      new Request("https://example.com/api/workers/jobs/viability-job-1/complete", {
        method: "POST",
        body: JSON.stringify({
          type: "inbox_generation",
          output: createViabilityOutput()
        })
      }),
      { params: Promise.resolve({ jobId: "viability-job-1" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Worker job is not claimable by this worker"
    });
    expect(mocked.routeCompleteViability).not.toHaveBeenCalled();
    expect(mocked.routeCompleteInbox).not.toHaveBeenCalled();
  });

  it("marks a running worker job failed when completion output is malformed", async () => {
    mocked.routeReadBearerToken.mockReturnValue("worker-token");
    mocked.routeFindWorkers.mockResolvedValue([
      { id: "worker-1", userId: "user-1", tokenHash: "stored-hash" }
    ]);
    mocked.routeVerifyWorkerToken.mockResolvedValue(true);
    mocked.routeUpdateWorker.mockResolvedValue({});
    mocked.inboxFindFirst.mockResolvedValue({ id: "inbox-job-1" });
    mocked.viabilityFindFirst.mockResolvedValue(null);
    mocked.routeCompleteInbox.mockRejectedValue(new Error("Generated inbox schema error"));
    mocked.inboxUpdateMany.mockResolvedValue({ count: 1 });

    vi.doMock("@/lib/jobs/viability", () => ({
      claimNextViabilityJob: vi.fn(),
      completeV2ViabilityJob: (...args: unknown[]) => mocked.routeCompleteViability(...args),
      createV2ViabilityJob: vi.fn()
    }));
    vi.resetModules();
    const { POST } = await import("@/app/api/workers/jobs/[jobId]/complete/route");

    const response = await POST(
      new Request("https://example.com/api/workers/jobs/inbox-job-1/complete", {
        method: "POST",
        body: JSON.stringify({
          type: "inbox_generation",
          output: { malformed: true }
        })
      }),
      { params: Promise.resolve({ jobId: "inbox-job-1" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Generated inbox schema error" });
    expect(mocked.inboxUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "inbox-job-1",
        claimedByWorkerId: "worker-1",
        status: "running"
      },
      data: {
        status: "failed",
        errorMessage: "Generated inbox schema error",
        completedAt: expect.any(Date)
      }
    });
  });

  it("marks a running worker job failed when the worker reports an execution error", async () => {
    mocked.routeReadBearerToken.mockReturnValue("worker-token");
    mocked.routeFindWorkers.mockResolvedValue([
      { id: "worker-1", userId: "user-1", tokenHash: "stored-hash" }
    ]);
    mocked.routeVerifyWorkerToken.mockResolvedValue(true);
    mocked.routeUpdateWorker.mockResolvedValue({});
    mocked.inboxFindFirst.mockResolvedValue(null);
    mocked.viabilityFindFirst.mockResolvedValue({ id: "viability-job-1" });
    mocked.viabilityUpdateMany.mockResolvedValue({ count: 1 });

    vi.doMock("@/lib/jobs/viability", () => ({
      claimNextViabilityJob: vi.fn(),
      completeV2ViabilityJob: (...args: unknown[]) => mocked.routeCompleteViability(...args),
      createV2ViabilityJob: vi.fn()
    }));
    vi.resetModules();
    const { POST } = await import("@/app/api/workers/jobs/[jobId]/complete/route");

    const response = await POST(
      new Request("https://example.com/api/workers/jobs/viability-job-1/complete", {
        method: "POST",
        body: JSON.stringify({
          type: "viability_check",
          error: "Codex CLI is not authenticated"
        })
      }),
      { params: Promise.resolve({ jobId: "viability-job-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocked.viabilityUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "viability-job-1",
        claimedByWorkerId: "worker-1",
        status: "running"
      },
      data: {
        status: "failed",
        errorMessage: "Codex CLI is not authenticated",
        completedAt: expect.any(Date)
      }
    });
    expect(mocked.routeCompleteViability).not.toHaveBeenCalled();
    expect(mocked.routeCompleteInbox).not.toHaveBeenCalled();
  });

  it("marks a running worker job failed when the completion request body is malformed JSON", async () => {
    mocked.routeReadBearerToken.mockReturnValue("worker-token");
    mocked.routeFindWorkers.mockResolvedValue([
      { id: "worker-1", userId: "user-1", tokenHash: "stored-hash" }
    ]);
    mocked.routeVerifyWorkerToken.mockResolvedValue(true);
    mocked.routeUpdateWorker.mockResolvedValue({});
    mocked.inboxFindFirst.mockResolvedValue({ id: "inbox-job-1" });
    mocked.viabilityFindFirst.mockResolvedValue(null);
    mocked.inboxUpdateMany.mockResolvedValue({ count: 1 });

    vi.doMock("@/lib/jobs/viability", () => ({
      claimNextViabilityJob: vi.fn(),
      completeV2ViabilityJob: (...args: unknown[]) => mocked.routeCompleteViability(...args),
      createV2ViabilityJob: vi.fn()
    }));
    vi.resetModules();
    const { POST } = await import("@/app/api/workers/jobs/[jobId]/complete/route");

    const response = await POST(
      new Request("https://example.com/api/workers/jobs/inbox-job-1/complete", {
        method: "POST",
        body: "{not valid json"
      }),
      { params: Promise.resolve({ jobId: "inbox-job-1" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Malformed worker completion request JSON"
    });
    expect(mocked.inboxUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "inbox-job-1",
        claimedByWorkerId: "worker-1",
        status: "running"
      },
      data: {
        status: "failed",
        errorMessage: "Malformed worker completion request JSON",
        completedAt: expect.any(Date)
      }
    });
    expect(mocked.routeCompleteInbox).not.toHaveBeenCalled();
    expect(mocked.routeCompleteViability).not.toHaveBeenCalled();
  });
});
