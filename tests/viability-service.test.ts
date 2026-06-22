import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) {
      throw new Error("Test prisma client has not been initialized");
    }

    return mocked.prisma;
  }
}));

const serviceModulePromise = import("@/lib/viability/service");

function toSqliteUrl(path: string): string {
  return `file:${path.replace(/\\/g, "/")}`;
}

function pushSchema(databaseUrl: string): void {
  const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");

  execFileSync(
    process.execPath,
    [prismaCli, "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl
      },
      stdio: "ignore"
    }
  );
}

async function withTestDatabase(run: (client: PrismaClient) => Promise<void>): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "research-finder-viability-"));
  const databaseUrl = toSqliteUrl(join(tempDir, "test.db"));
  const client = new PrismaClient({
    datasourceUrl: databaseUrl
  });

  try {
    pushSchema(databaseUrl);
    mocked.prisma = client;
    await run(client);
  } finally {
    mocked.prisma = null;
    await client.$disconnect();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("buildViabilityDecision", () => {
  it("requires prototype, research, and novelty signals for expand verdict", async () => {
    const { buildViabilityDecision } = await serviceModulePromise;
    const decision = buildViabilityDecision({
      ideaTitle: "Build a benchmark slice",
      paperTitle: "Agent evaluation benchmark",
      sprintDepth: "default",
      autonomyLevel: "medium"
    });

    expect(decision.verdict).toBe("expand");
    expect(decision.prototypeSignal.status).toBe("pass");
    expect(decision.researchSignal.status).toBe("pass");
    expect(decision.noveltySignal.status).toBe("pass");
    expect(decision.artifacts).toHaveLength(1);
    expect(decision.artifacts[0]).toMatchObject({
      kind: "decision-report"
    });
    expect(decision.artifacts[0].title).toContain("Viability");
    expect(decision.artifacts[0].content).toContain("# Verdict");
    expect(decision.artifacts[0].content).toContain("# Prototype signal");
    expect(decision.artifacts[0].content).toContain("# Research signal");
    expect(decision.artifacts[0].content).toContain("# Novelty signal");
  });
});

describe("processNextViabilityJob", () => {
  it(
    "processes exactly the oldest queued job and preserves decision evidence",
    async () => {
      const { processNextViabilityJob } = await serviceModulePromise;

      await withTestDatabase(async (client) => {
        const oldest = await createQueuedJob(client, {
          suffix: "oldest",
          createdAt: new Date("2026-06-20T00:00:00.000Z")
        });
        const newer = await createQueuedJob(client, {
          suffix: "newer",
          createdAt: new Date("2026-06-21T00:00:00.000Z")
        });

        const processedId = await processNextViabilityJob();

        expect(processedId).toBe(oldest.jobId);

        const completedJob = await client.viabilityJob.findUniqueOrThrow({
          where: { id: oldest.jobId },
          include: {
            artifacts: true,
            evidence: true
          }
        });

        expect(completedJob.status).toBe("completed");
        expect(completedJob.verdict).toBe("expand");
        expect(completedJob.startedAt).toBeInstanceOf(Date);
        expect(completedJob.completedAt).toBeInstanceOf(Date);
        expect(completedJob.artifacts.filter((artifact) => artifact.kind === "decision-report"))
          .toHaveLength(1);
        expect(completedJob.evidence.length).toBeGreaterThan(0);
        expect(completedJob.evidence.every((evidence) => evidence.sourceUrl === oldest.paperUrl))
          .toBe(true);

        const remainingJob = await client.viabilityJob.findUniqueOrThrow({
          where: { id: newer.jobId },
          include: {
            artifacts: true,
            evidence: true
          }
        });

        expect(remainingJob.status).toBe("queued");
        expect(remainingJob.artifacts).toHaveLength(0);
        expect(remainingJob.evidence).toHaveLength(0);
      });
    },
    15000
  );

  it(
    "returns null when no queued jobs exist",
    async () => {
      const { processNextViabilityJob } = await serviceModulePromise;

      await withTestDatabase(async () => {
        await expect(processNextViabilityJob()).resolves.toBeNull();
      });
    },
    15000
  );

  it("returns null when another worker claims the selected queued job first", async () => {
    const { processNextViabilityJob } = await serviceModulePromise;
    const fakePrisma = {
      viabilityJob: {
        findFirst: vi.fn().mockResolvedValue({
          id: "job-claimed-elsewhere",
          sprintDepth: "default",
          autonomyLevel: "medium",
          idea: {
            title: "Already claimed idea",
            paper: {
              title: "Already claimed paper",
              url: "https://arxiv.org/abs/already-claimed"
            }
          }
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      artifact: {
        createMany: vi.fn()
      },
      evidence: {
        createMany: vi.fn()
      },
      $transaction: vi.fn()
    };

    mocked.prisma = fakePrisma as unknown as PrismaClient;

    try {
      await expect(processNextViabilityJob()).resolves.toBeNull();
      expect(fakePrisma.viabilityJob.updateMany).toHaveBeenCalledWith({
        where: {
          id: "job-claimed-elsewhere",
          status: "queued"
        },
        data: expect.objectContaining({
          status: "running"
        })
      });
      expect(fakePrisma.artifact.createMany).not.toHaveBeenCalled();
      expect(fakePrisma.evidence.createMany).not.toHaveBeenCalled();
      expect(fakePrisma.$transaction).not.toHaveBeenCalled();
    } finally {
      mocked.prisma = null;
    }
  });
});

async function createQueuedJob(
  client: PrismaClient,
  input: {
    suffix: string;
    createdAt: Date;
  }
): Promise<{ jobId: string; paperUrl: string }> {
  const user = await client.user.upsert({
    where: { id: "user-1" },
    update: {},
    create: {
      id: "user-1",
      email: "user-1@example.com",
      name: "User One"
    }
  });

  const paperUrl = `https://arxiv.org/abs/${input.suffix}`;
  const paper = await client.paper.create({
    data: {
      arxivId: `paper-${input.suffix}`,
      title: `Paper ${input.suffix}`,
      abstract: `Abstract ${input.suffix}`,
      url: paperUrl,
      publishedAt: new Date("2026-06-01T00:00:00.000Z"),
      arxivUpdatedAt: new Date("2026-06-01T00:00:00.000Z"),
      authorsJson: JSON.stringify(["Author"]),
      categoriesJson: JSON.stringify(["cs.AI"])
    }
  });

  const idea = await client.idea.create({
    data: {
      paperId: paper.id,
      title: `Idea ${input.suffix}`,
      summary: `Summary ${input.suffix}`,
      rationale: `Rationale ${input.suffix}`,
      approach: `Approach ${input.suffix}`,
      risksJson: JSON.stringify(["Risk"]),
      nextStepsJson: JSON.stringify(["Step"]),
      tagsJson: JSON.stringify(["tag"]),
      generatedBy: "test"
    }
  });

  const job = await client.viabilityJob.create({
    data: {
      userId: user.id,
      ideaId: idea.id,
      sprintDepth: "default",
      autonomyLevel: "medium",
      status: "queued",
      createdAt: input.createdAt
    }
  });

  return {
    jobId: job.id,
    paperUrl
  };
}
