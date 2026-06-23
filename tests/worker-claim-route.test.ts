import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  claimNextJob: vi.fn(),
  findWorkers: vi.fn(),
  readBearerToken: vi.fn(),
  updateJob: vi.fn(),
  updateWorker: vi.fn(),
  verifyWorkerToken: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    inboxGenerationJob: {
      update: (...args: unknown[]) => mocked.updateJob(...args)
    },
    workerRegistration: {
      findMany: (...args: unknown[]) => mocked.findWorkers(...args),
      update: (...args: unknown[]) => mocked.updateWorker(...args)
    }
  }
}));

vi.mock("@/lib/jobs/inbox-generation", () => ({
  claimNextInboxGenerationJob: (...args: unknown[]) => mocked.claimNextJob(...args)
}));

vi.mock("@/lib/jobs/worker-auth", () => ({
  readBearerToken: (...args: unknown[]) => mocked.readBearerToken(...args),
  verifyWorkerToken: (...args: unknown[]) => mocked.verifyWorkerToken(...args)
}));

const routePromise = import("@/app/api/workers/claim/route");

afterEach(() => {
  mocked.claimNextJob.mockReset();
  mocked.findWorkers.mockReset();
  mocked.readBearerToken.mockReset();
  mocked.updateJob.mockReset();
  mocked.updateWorker.mockReset();
  mocked.verifyWorkerToken.mockReset();
});

describe("worker claim route", () => {
  it("marks a claimed job failed when its worker payload cannot be built", async () => {
    mocked.readBearerToken.mockReturnValue("worker-token");
    mocked.findWorkers.mockResolvedValue([
      { id: "worker-1", userId: "user-1", tokenHash: "stored-hash" }
    ]);
    mocked.verifyWorkerToken.mockResolvedValue(true);
    mocked.updateWorker.mockResolvedValue({});
    mocked.claimNextJob.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      inboxDate: "2026-06-23",
      candidateBatch: {
        candidates: [
          {
            arxivId: "2606.00001",
            title: "Candidate",
            abstract: "Candidate abstract",
            url: "https://arxiv.org/abs/2606.00001",
            authorsJson: JSON.stringify(["Author"]),
            categoriesJson: JSON.stringify(["cs.AI"]),
            publishedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ]
      },
      user: {
        profile: {
          fieldPresetKey: "ai_ml",
          keywordsJson: JSON.stringify({ corrupted: true }),
          constraintsJson: JSON.stringify(["Constraint"]),
          preferredOutputsJson: JSON.stringify(["benchmark"]),
          arxivQuery: "cat:cs.AI"
        }
      }
    });
    mocked.updateJob.mockResolvedValue({});

    const { POST } = await routePromise;
    const response = await POST(new Request("https://example.com/api/workers/claim"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Claimed job payload could not be built"
    });
    expect(mocked.updateJob).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "failed",
        errorMessage: "keywordsJson must be a JSON array",
        completedAt: expect.any(Date)
      }
    });
  });
});
