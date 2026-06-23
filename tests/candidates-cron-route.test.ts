import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  findUsers: vi.fn(),
  createBatch: vi.fn(),
  createJob: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => mocked.findUsers(...args)
    }
  }
}));

vi.mock("@/lib/sources/arxiv-candidates", () => ({
  createArxivCandidateBatchForUser: (...args: unknown[]) => mocked.createBatch(...args)
}));

vi.mock("@/lib/jobs/inbox-generation", () => ({
  createInboxGenerationJob: (...args: unknown[]) => mocked.createJob(...args)
}));

const routePromise = import("@/app/api/cron/candidates/route");

afterEach(() => {
  vi.unstubAllEnvs();
  mocked.findUsers.mockReset();
  mocked.createBatch.mockReset();
  mocked.createJob.mockReset();
});

describe("candidate cron route", () => {
  it("continues creating jobs for later users when one user fails", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    mocked.findUsers.mockResolvedValue([{ id: "user-1" }, { id: "user-2" }, { id: "user-3" }]);
    mocked.createBatch
      .mockResolvedValueOnce({ id: "batch-1" })
      .mockRejectedValueOnce(new Error("arxiv failed"))
      .mockResolvedValueOnce({ id: "batch-3" });
    mocked.createJob
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({ id: "job-3" });

    const { POST } = await routePromise;
    const response = await POST(
      new Request("https://example.com/api/cron/candidates", {
        method: "POST",
        headers: { authorization: "Bearer secret" }
      })
    );

    await expect(response.json()).resolves.toEqual({
      createdJobs: 2,
      failedUsers: [{ userId: "user-2", error: "arxiv failed" }]
    });
    expect(response.status).toBe(200);
    expect(mocked.createBatch).toHaveBeenCalledTimes(3);
    expect(mocked.createJob).toHaveBeenCalledTimes(2);
    expect(mocked.createJob).toHaveBeenLastCalledWith({
      userId: "user-3",
      candidateBatchId: "batch-3",
      inboxDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    });
  });
});
