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
  it("loads profiled user emails before allowlist filtering", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", " allowed@example.com ");
    mocked.findUsers.mockResolvedValue([]);

    const { POST } = await routePromise;
    const response = await POST(
      new Request("https://example.com/api/cron/candidates", {
        method: "POST",
        headers: { authorization: "Bearer secret" }
      })
    );

    expect(response.status).toBe(200);
    expect(mocked.findUsers).toHaveBeenCalledWith({
      where: { profile: { isNot: null } },
      select: { id: true, email: true }
    });
    expect(mocked.createBatch).not.toHaveBeenCalled();
    expect(mocked.createJob).not.toHaveBeenCalled();
  });

  it("filters profiled users through the case-insensitive email allowlist", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "allowed@example.com");
    mocked.findUsers.mockResolvedValue([
      { id: "user-1", email: "Allowed@Example.com" },
      { id: "user-2", email: "removed@example.com" },
      { id: "user-3", email: null }
    ]);
    mocked.createBatch.mockResolvedValue({ id: "batch-1" });
    mocked.createJob.mockResolvedValue({ id: "job-1" });

    const { POST } = await routePromise;
    const response = await POST(
      new Request("https://example.com/api/cron/candidates", {
        method: "POST",
        headers: { authorization: "Bearer secret" }
      })
    );

    expect(response.status).toBe(200);
    expect(mocked.findUsers).toHaveBeenCalledWith({
      where: { profile: { isNot: null } },
      select: { id: true, email: true }
    });
    expect(mocked.createBatch).toHaveBeenCalledTimes(1);
    expect(mocked.createBatch).toHaveBeenCalledWith("user-1", expect.any(String));
    expect(mocked.createJob).toHaveBeenCalledWith({
      userId: "user-1",
      candidateBatchId: "batch-1",
      inboxDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    });
  });

  it("continues creating jobs for later users when one user fails", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv(
      "ALLOWED_GOOGLE_EMAILS",
      "user-1@example.com,user-2@example.com,user-3@example.com"
    );
    mocked.findUsers.mockResolvedValue([
      { id: "user-1", email: "user-1@example.com" },
      { id: "user-2", email: "user-2@example.com" },
      { id: "user-3", email: "user-3@example.com" }
    ]);
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

  it("skips inbox generation jobs for empty candidate batches", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "user-1@example.com");
    mocked.findUsers.mockResolvedValue([{ id: "user-1", email: "user-1@example.com" }]);
    mocked.createBatch.mockResolvedValue({ id: "batch-1", candidates: [] });

    const { POST } = await routePromise;
    const response = await POST(
      new Request("https://example.com/api/cron/candidates", {
        method: "POST",
        headers: { authorization: "Bearer secret" }
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      createdJobs: 0,
      skippedUsers: [{ userId: "user-1", reason: "No arXiv candidates" }],
      failedUsers: []
    });
    expect(mocked.createJob).not.toHaveBeenCalled();
  });

  it("returns 500 with a summary when every profiled user fails", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "user-1@example.com,user-2@example.com");
    mocked.findUsers.mockResolvedValue([
      { id: "user-1", email: "user-1@example.com" },
      { id: "user-2", email: "user-2@example.com" }
    ]);
    mocked.createBatch
      .mockRejectedValueOnce(new Error("first failed"))
      .mockRejectedValueOnce(new Error("second failed"));

    const { POST } = await routePromise;
    const response = await POST(
      new Request("https://example.com/api/cron/candidates", {
        method: "POST",
        headers: { authorization: "Bearer secret" }
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      createdJobs: 0,
      failedUsers: [
        { userId: "user-1", error: "first failed" },
        { userId: "user-2", error: "second failed" }
      ]
    });
    expect(mocked.createBatch).toHaveBeenCalledTimes(2);
    expect(mocked.createJob).not.toHaveBeenCalled();
  });

  it("creates jobs for a GET request (Vercel cron) with a valid bearer", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "user-1@example.com");
    mocked.findUsers.mockResolvedValue([{ id: "user-1", email: "user-1@example.com" }]);
    mocked.createBatch.mockResolvedValue({ id: "batch-1", candidates: [{ id: "c1" }] });
    mocked.createJob.mockResolvedValue({ id: "job-1" });

    const { GET } = await routePromise;
    const response = await GET(
      new Request("https://example.com/api/cron/candidates", {
        method: "GET",
        headers: { authorization: "Bearer secret" }
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ createdJobs: 1, failedUsers: [] });
    expect(mocked.createJob).toHaveBeenCalledWith({
      userId: "user-1",
      candidateBatchId: "batch-1",
      inboxDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    });
  });

  it("rejects a GET request with a missing or wrong bearer", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    mocked.findUsers.mockResolvedValue([]);

    const { GET } = await routePromise;
    const response = await GET(
      new Request("https://example.com/api/cron/candidates", {
        method: "GET",
        headers: { authorization: "Bearer wrong" }
      })
    );

    expect(response.status).toBe(401);
    expect(mocked.findUsers).not.toHaveBeenCalled();
  });
});
