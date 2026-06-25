import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  claimNextJob: vi.fn(),
  claimNextNoveltyScanJob: vi.fn(),
  claimNextViabilityJob: vi.fn(),
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
    inboxNoveltyScanJob: {
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

vi.mock("@/lib/jobs/novelty-scan", () => ({
  claimNextNoveltyScanJob: (...args: unknown[]) => mocked.claimNextNoveltyScanJob(...args)
}));

vi.mock("@/lib/jobs/viability", () => ({
  claimNextViabilityJob: (...args: unknown[]) => mocked.claimNextViabilityJob(...args)
}));

vi.mock("@/lib/jobs/worker-auth", () => ({
  readBearerToken: (...args: unknown[]) => mocked.readBearerToken(...args),
  verifyWorkerToken: (...args: unknown[]) => mocked.verifyWorkerToken(...args)
}));

const routePromise = import("@/app/api/workers/claim/route");

afterEach(() => {
  vi.unstubAllEnvs();
  mocked.claimNextJob.mockReset();
  mocked.claimNextNoveltyScanJob.mockReset();
  mocked.claimNextViabilityJob.mockReset();
  mocked.findWorkers.mockReset();
  mocked.readBearerToken.mockReset();
  mocked.updateJob.mockReset();
  mocked.updateWorker.mockReset();
  mocked.verifyWorkerToken.mockReset();
});

describe("worker claim route", () => {
  it("rejects an active worker token when the owner email is no longer allowlisted", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "allowed@example.com");
    mocked.readBearerToken.mockReturnValue("worker-token");
    mocked.findWorkers.mockResolvedValue([
      {
        id: "worker-1",
        userId: "user-1",
        tokenHash: "stored-hash",
        user: { email: "removed@example.com" }
      }
    ]);
    mocked.verifyWorkerToken.mockResolvedValue(true);

    const { POST } = await routePromise;
    const response = await POST(new Request("https://example.com/api/workers/claim"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocked.findWorkers).toHaveBeenCalledWith({
      where: {
        status: "active",
        revokedAt: null
      },
      select: {
        id: true,
        userId: true,
        tokenHash: true,
        user: { select: { email: true } }
      }
    });
    expect(mocked.updateWorker).not.toHaveBeenCalled();
    expect(mocked.claimNextJob).not.toHaveBeenCalled();
    expect(mocked.claimNextViabilityJob).not.toHaveBeenCalled();
  });

  it("claims novelty scan jobs before viability jobs after inbox jobs are exhausted", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "worker@example.com");
    mocked.readBearerToken.mockReturnValue("worker-token");
    mocked.findWorkers.mockResolvedValue([
      {
        id: "worker-1",
        userId: "user-1",
        tokenHash: "stored-hash",
        user: { email: "worker@example.com" }
      }
    ]);
    mocked.verifyWorkerToken.mockResolvedValue(true);
    mocked.updateWorker.mockResolvedValue({});
    mocked.claimNextJob.mockResolvedValue(null);
    mocked.claimNextNoveltyScanJob.mockResolvedValue({
      id: "novelty-job-1",
      userId: "user-1",
      inboxDate: "2026-06-25",
      status: "running",
      claimedByWorkerId: "worker-1",
      user: {
        profile: {
          fieldPresetKey: "ai_ml",
          keywordsJson: "[\"agent evaluation\"]",
          constraintsJson: "[]",
          preferredOutputsJson: "[\"benchmark\"]",
          allowRelatedWorkSearch: true
        }
      },
      inboxGenerationJob: {
        generatedIdeas: [
          {
            id: "idea-1",
            title: "AutoBenchsmith",
            summary: "Generate benchmark items.",
            expandedExplanation: "Expanded.",
            trajectory: "Trajectory.",
            smallestSprint: "Build a pilot.",
            paper: {
              id: "paper-1",
              arxivId: "2606.00001",
              title: "Paper title",
              abstract: "Paper abstract",
              url: "https://arxiv.org/abs/2606.00001",
              authorsJson: "[\"A. Researcher\"]",
              categoriesJson: "[\"cs.AI\"]",
              publishedAt: new Date("2026-06-25T00:00:00.000Z")
            },
            citations: []
          }
        ]
      }
    });

    const { POST } = await routePromise;
    const response = await POST(new Request("https://example.com/api/workers/claim"));
    const body = await response.json();

    expect(body.job.type).toBe("novelty_scan");
    expect(body.job.input.ideas[0].id).toBe("idea-1");
  });

  it("marks a claimed job failed when its worker payload cannot be built", async () => {
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "allowed@example.com");
    mocked.readBearerToken.mockReturnValue("worker-token");
    mocked.findWorkers.mockResolvedValue([
      {
        id: "worker-1",
        userId: "user-1",
        tokenHash: "stored-hash",
        user: { email: "allowed@example.com" }
      }
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
