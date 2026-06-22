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

const serviceModulePromise = import("@/lib/dispatch/service");

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
  const tempDir = mkdtempSync(join(tmpdir(), "research-finder-dispatch-"));
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

describe("validateDispatchSettings", () => {
  it("accepts valid sprint depth and autonomy settings", async () => {
    const { validateDispatchSettings } = await serviceModulePromise;

    expect(validateDispatchSettings("default", "medium")).toEqual({
      sprintDepth: "default",
      autonomyLevel: "medium"
    });
  });

  it("rejects invalid values", async () => {
    const { validateDispatchSettings } = await serviceModulePromise;

    expect(() => validateDispatchSettings("huge", "medium")).toThrow("Invalid sprint depth");
    expect(() => validateDispatchSettings("fast", "reckless")).toThrow("Invalid autonomy level");
  });
});

describe("createViabilityJob", () => {
  it(
    "creates a queued viability job for an idea in the user's inbox",
    async () => {
      const { createViabilityJob } = await serviceModulePromise;

      await withTestDatabase(async (client) => {
        const { ideaId } = await createInboxFixture(client, {
          userId: "user-1",
          ideaSuffix: "available"
        });

        const job = await createViabilityJob({
          userId: "user-1",
          ideaId,
          sprintDepth: "default",
          autonomyLevel: "medium"
        });

        expect(job).toMatchObject({
          userId: "user-1",
          ideaId,
          sprintDepth: "default",
          autonomyLevel: "medium",
          status: "queued"
        });
      });
    },
    15000
  );

  it(
    "rejects an existing idea that is not in the user's inbox",
    async () => {
      const { createViabilityJob } = await serviceModulePromise;

      await withTestDatabase(async (client) => {
        await client.user.create({
          data: {
            id: "user-1",
            email: "user-1@example.com",
            name: "User One"
          }
        });

        const { ideaId } = await createInboxFixture(client, {
          userId: "user-2",
          ideaSuffix: "other-user"
        });

        await expect(
          createViabilityJob({
            userId: "user-1",
            ideaId,
            sprintDepth: "default",
            autonomyLevel: "medium"
          })
        ).rejects.toThrow("Idea is not available in this user's inbox");

        await expect(client.viabilityJob.count()).resolves.toBe(0);
      });
    },
    15000
  );
});

async function createInboxFixture(
  client: PrismaClient,
  input: {
    userId: string;
    ideaSuffix: string;
  }
): Promise<{ ideaId: string }> {
  const user = await client.user.upsert({
    where: { id: input.userId },
    update: {},
    create: {
      id: input.userId,
      email: `${input.userId}@example.com`,
      name: input.userId
    }
  });

  const paper = await client.paper.create({
    data: {
      arxivId: `paper-${input.ideaSuffix}`,
      title: `Paper ${input.ideaSuffix}`,
      abstract: `Abstract ${input.ideaSuffix}`,
      url: `https://arxiv.org/abs/${input.ideaSuffix}`,
      publishedAt: new Date("2026-06-01T00:00:00.000Z"),
      arxivUpdatedAt: new Date("2026-06-01T00:00:00.000Z"),
      authorsJson: JSON.stringify(["Author"]),
      categoriesJson: JSON.stringify(["cs.AI"])
    }
  });

  const idea = await client.idea.create({
    data: {
      paperId: paper.id,
      title: `Idea ${input.ideaSuffix}`,
      summary: `Summary ${input.ideaSuffix}`,
      rationale: `Rationale ${input.ideaSuffix}`,
      approach: `Approach ${input.ideaSuffix}`,
      risksJson: JSON.stringify(["Risk"]),
      nextStepsJson: JSON.stringify(["Step"]),
      tagsJson: JSON.stringify(["tag"]),
      generatedBy: "test"
    }
  });

  await client.inboxItem.create({
    data: {
      userId: user.id,
      paperId: paper.id,
      bestIdeaId: idea.id,
      inboxDate: "2026-06-22",
      overallScore: 0.9,
      paperQuality: 0.9,
      projectOpportunity: 0.9,
      dispatchLikelihood: 0.9,
      reasoningJson: JSON.stringify({
        whyPaperMatters: "matters",
        whyIdeaPromising: "promising",
        whyItMightBeTrap: "trap",
        smallestSprint: "sprint",
        suggestedDepth: "default",
        suggestedAutonomy: "medium"
      })
    }
  });

  return { ideaId: idea.id };
}
