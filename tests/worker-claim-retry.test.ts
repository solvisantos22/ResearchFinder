import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  candidateBatchFindFirst: vi.fn(),
  findFirst: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  transaction: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mocked.transaction(...args),
    candidateBatch: {
      findFirst: (...args: unknown[]) => mocked.candidateBatchFindFirst(...args)
    },
    inboxGenerationJob: {
      findFirst: (...args: unknown[]) => mocked.findFirst(...args),
      findUniqueOrThrow: (...args: unknown[]) => mocked.findUniqueOrThrow(...args),
      upsert: (...args: unknown[]) => mocked.upsert(...args),
      updateMany: (...args: unknown[]) => mocked.updateMany(...args)
    }
  }
}));

const servicePromise = import("@/lib/jobs/inbox-generation");

afterEach(() => {
  vi.useRealTimers();
  mocked.candidateBatchFindFirst.mockReset();
  mocked.findFirst.mockReset();
  mocked.findUniqueOrThrow.mockReset();
  mocked.transaction.mockReset();
  mocked.upsert.mockReset();
  mocked.updateMany.mockReset();
});

describe("claimNextInboxGenerationJob retry", () => {
  it("retries selection when another worker claims the selected job first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T12:00:00.000Z"));
    mocked.findFirst
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({ id: "job-2" });
    mocked.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocked.findUniqueOrThrow.mockResolvedValue({ id: "job-2", status: "running" });

    const { claimNextInboxGenerationJob } = await servicePromise;
    const result = await claimNextInboxGenerationJob({
      userId: "user-1",
      workerId: "worker-1"
    });

    expect(result).toEqual({ id: "job-2", status: "running" });
    expect(mocked.findFirst).toHaveBeenCalledTimes(2);
    expect(mocked.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { status: "queued" },
          { status: "running", startedAt: { lte: new Date("2026-06-23T11:30:00.000Z") } }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    expect(mocked.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "job-1",
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
    expect(mocked.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "job-2",
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
    expect(mocked.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "job-2" },
      include: {
        candidateBatch: {
          include: {
            candidates: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }]
            }
          }
        },
        user: {
          include: { profile: true }
        }
      }
    });
  });

  it("reclaims a running inbox generation job after the stale timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T12:00:00.000Z"));
    mocked.findFirst.mockResolvedValueOnce({
      id: "stale-job",
      status: "running",
      startedAt: new Date("2026-06-23T11:20:00.000Z")
    });
    mocked.updateMany.mockResolvedValueOnce({ count: 1 });
    mocked.findUniqueOrThrow.mockResolvedValue({ id: "stale-job", status: "running" });

    const { claimNextInboxGenerationJob } = await servicePromise;
    const result = await claimNextInboxGenerationJob({
      userId: "user-1",
      workerId: "worker-2"
    });

    expect(result).toEqual({ id: "stale-job", status: "running" });
    expect(mocked.updateMany).toHaveBeenCalledWith({
      where: {
        id: "stale-job",
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

describe("createInboxGenerationJob retry lifecycle", () => {
  it("resets failed or timed-out jobs before reusing the same daily inbox generation job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T12:00:00.000Z"));
    const tx = {
      candidateBatch: {
        findFirst: mocked.candidateBatchFindFirst
      },
      inboxGenerationJob: {
        updateMany: mocked.updateMany,
        upsert: mocked.upsert
      }
    };
    mocked.transaction.mockImplementation(
      async (run: (transactionClient: typeof tx) => Promise<unknown>) => run(tx)
    );
    mocked.candidateBatchFindFirst.mockResolvedValue({
      id: "batch-1",
      status: "completed",
      completedAt: new Date("2026-06-23T10:00:00.000Z")
    });
    mocked.updateMany.mockResolvedValue({ count: 1 });
    mocked.upsert.mockResolvedValue({
      id: "job-1",
      status: "queued",
      claimedByWorkerId: null,
      completedAt: null,
      errorMessage: null
    });

    const { createInboxGenerationJob } = await servicePromise;
    const job = await createInboxGenerationJob({
      userId: "user-1",
      candidateBatchId: "batch-1",
      inboxDate: "2026-06-23"
    });

    expect(job).toMatchObject({ id: "job-1", status: "queued" });
    expect(mocked.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        candidateBatchId: "batch-1",
        inboxDate: "2026-06-23",
        OR: [
          { status: "failed" },
          { status: "running", startedAt: { lte: new Date("2026-06-23T11:30:00.000Z") } }
        ]
      },
      data: {
        status: "queued",
        claimedByWorkerId: null,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        outputJson: null,
        inputJson: JSON.stringify({ candidateBatchId: "batch-1" })
      }
    });
    expect(mocked.upsert).toHaveBeenCalledWith({
      where: {
        userId_candidateBatchId_inboxDate: {
          userId: "user-1",
          candidateBatchId: "batch-1",
          inboxDate: "2026-06-23"
        }
      },
      update: {},
      create: {
        userId: "user-1",
        candidateBatchId: "batch-1",
        inboxDate: "2026-06-23",
        status: "queued",
        inputJson: JSON.stringify({ candidateBatchId: "batch-1" })
      }
    });
  });
});
