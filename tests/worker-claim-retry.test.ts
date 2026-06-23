import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  updateMany: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    inboxGenerationJob: {
      findFirst: (...args: unknown[]) => mocked.findFirst(...args),
      findUniqueOrThrow: (...args: unknown[]) => mocked.findUniqueOrThrow(...args),
      updateMany: (...args: unknown[]) => mocked.updateMany(...args)
    }
  }
}));

const servicePromise = import("@/lib/jobs/inbox-generation");

afterEach(() => {
  mocked.findFirst.mockReset();
  mocked.findUniqueOrThrow.mockReset();
  mocked.updateMany.mockReset();
});

describe("claimNextInboxGenerationJob retry", () => {
  it("retries selection when another worker claims the selected job first", async () => {
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
        status: "queued"
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    expect(mocked.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "job-1",
        status: "queued",
        userId: "user-1"
      },
      data: {
        status: "running",
        claimedByWorkerId: "worker-1",
        startedAt: expect.any(Date)
      }
    });
    expect(mocked.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "job-2",
        status: "queued",
        userId: "user-1"
      },
      data: {
        status: "running",
        claimedByWorkerId: "worker-1",
        startedAt: expect.any(Date)
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
});
