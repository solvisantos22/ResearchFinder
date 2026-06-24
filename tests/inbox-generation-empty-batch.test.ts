import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  transaction: vi.fn(),
  tx: {
    candidateBatch: {
      findFirst: vi.fn()
    },
    inboxGenerationJob: {
      updateMany: vi.fn(),
      upsert: vi.fn()
    }
  }
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mocked.transaction(...args)
  }
}));

describe("createInboxGenerationJob empty candidate batches", () => {
  it("rejects completed candidate batches with no papers", async () => {
    const { createInboxGenerationJob } = await import("@/lib/jobs/inbox-generation");
    mocked.tx.candidateBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      status: "completed",
      completedAt: new Date("2026-06-23T12:00:00.000Z"),
      _count: { candidates: 0 }
    });
    mocked.transaction.mockImplementation(async (run: (tx: typeof mocked.tx) => Promise<unknown>) =>
      run(mocked.tx)
    );

    await expect(
      createInboxGenerationJob({
        userId: "user-1",
        candidateBatchId: "batch-1",
        inboxDate: "2026-06-23"
      })
    ).rejects.toThrow("Candidate batch has no papers for inbox generation");

    expect(mocked.tx.inboxGenerationJob.updateMany).not.toHaveBeenCalled();
    expect(mocked.tx.inboxGenerationJob.upsert).not.toHaveBeenCalled();
  });
});
