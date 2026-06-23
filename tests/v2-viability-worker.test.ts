import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  artifactCreate: vi.fn(),
  evidenceCreateMany: vi.fn(),
  inboxFindFirst: vi.fn(),
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
      findFirst: (...args: unknown[]) => mocked.inboxFindFirst(...args)
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
  vi.clearAllMocks();
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

describe("claimNextViabilityJob", () => {
  it("claims the oldest queued viability job owned by the worker user", async () => {
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
        status: "queued"
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    expect(mocked.viabilityUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "older-job",
        userId: "user-1",
        status: "queued"
      },
      data: {
        status: "running",
        claimedByWorkerId: "worker-1",
        startedAt: expect.any(Date),
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
    mocked.viabilityFindFirstOrThrow.mockResolvedValue({
      id: "viability-job-1",
      status: "running",
      claimedByWorkerId: "worker-1"
    });
    mocked.evidenceCreateMany.mockReturnValue({ operation: "create-evidence" });
    mocked.artifactCreate.mockReturnValue({ operation: "create-artifact" });
    mocked.viabilityUpdate.mockReturnValue({ operation: "update-job" });
    mocked.transaction.mockResolvedValue([]);

    const { completeV2ViabilityJob } = await servicePromise;

    for (const verdict of ["expand", "needs_novelty_check", "revise", "reject"]) {
      await completeV2ViabilityJob({
        jobId: "viability-job-1",
        workerId: "worker-1",
        output: createViabilityOutput({ verdict })
      });
    }

    expect(mocked.viabilityFindFirstOrThrow).toHaveBeenCalledWith({
      where: {
        id: "viability-job-1",
        claimedByWorkerId: "worker-1",
        status: "running"
      }
    });
    expect(mocked.evidenceCreateMany).toHaveBeenCalledWith({
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
    expect(mocked.artifactCreate).toHaveBeenCalledWith({
      data: {
        jobId: "viability-job-1",
        kind: "viability-report",
        title: "Viability result: expand",
        content: expect.any(String)
      }
    });
    expect(JSON.parse(mocked.artifactCreate.mock.calls[0]?.[0].data.content)).toEqual(
      createViabilityOutput({ verdict: "expand" })
    );
    expect(mocked.viabilityUpdate).toHaveBeenCalledWith({
      where: { id: "viability-job-1" },
      data: {
        status: "completed",
        verdict: "expand",
        completedAt: expect.any(Date)
      }
    });
  });

  it("requires the completing worker to be the worker that claimed the job", async () => {
    mocked.viabilityFindFirstOrThrow.mockRejectedValue(new Error("No ViabilityJob found"));

    const { completeV2ViabilityJob } = await servicePromise;

    await expect(
      completeV2ViabilityJob({
        jobId: "viability-job-1",
        workerId: "worker-2",
        output: createViabilityOutput()
      })
    ).rejects.toThrow("No ViabilityJob found");

    expect(mocked.viabilityFindFirstOrThrow).toHaveBeenCalledWith({
      where: {
        id: "viability-job-1",
        claimedByWorkerId: "worker-2",
        status: "running"
      }
    });
    expect(mocked.transaction).not.toHaveBeenCalled();
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
});
