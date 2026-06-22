import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { defaultRankingWeights } from "@/lib/domain";
import { buildProfileSeedData, encodeJsonField, parseJsonField, seed } from "@/lib/seed";

const canonicalInterests = [
  "mechanistic interpretability",
  "reasoning evals",
  "agent evaluation",
  "AI safety"
];

const profileSelect = {
  interestsJson: true,
  constraintsJson: true,
  preferredOutputsJson: true,
  rankingWeightsJson: true,
  arxivQuery: true,
  maxDailyPapers: true
};

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
  const tempDir = mkdtempSync(join(tmpdir(), "research-finder-seed-"));
  const databaseUrl = toSqliteUrl(join(tempDir, "test.db"));
  const client = new PrismaClient({
    datasourceUrl: databaseUrl
  });

  try {
    pushSchema(databaseUrl);
    await run(client);
  } finally {
    await client.$disconnect();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("profile JSON helpers", () => {
  it("round-trips arrays and objects", () => {
    const values = ["LLM evaluation", "agent workflows"];
    const encoded = encodeJsonField(values);
    expect(parseJsonField<string[]>(encoded)).toEqual(values);

    const weights = { paperQuality: 0.35, projectOpportunity: 0.4 };
    expect(parseJsonField<typeof weights>(encodeJsonField(weights))).toEqual(weights);
  });

  it("builds the full profile seed payload", () => {
    const profile = buildProfileSeedData();

    expect(Object.keys(profile).sort()).toEqual(
      [
        "arxivQuery",
        "constraintsJson",
        "interestsJson",
        "maxDailyPapers",
        "preferredOutputsJson",
        "rankingWeightsJson"
      ].sort()
    );
    expect(parseJsonField<string[]>(profile.interestsJson)).toEqual(canonicalInterests);
    expect(parseJsonField<string[]>(profile.constraintsJson)).toEqual([
      "one-week prototype",
      "open-source models preferred"
    ]);
    expect(parseJsonField<string[]>(profile.preferredOutputsJson)).toEqual([
      "prototype",
      "paper draft"
    ]);
    expect(parseJsonField(profile.rankingWeightsJson)).toEqual(defaultRankingWeights);
    expect(profile.arxivQuery).toBe("cat:cs.AI OR cat:cs.CL OR cat:cs.LG");
    expect(profile.maxDailyPapers).toBe(10);
  });
});

describe("seed", () => {
  it("refreshes an existing research profile with the full seed payload", async () => {
    await withTestDatabase(async (client) => {
      await seed(client);

      const [solvi, collaborator] = await Promise.all([
        client.user.findUniqueOrThrow({
          where: { id: "demo-solvi" },
          select: { id: true, email: true }
        }),
        client.user.findUniqueOrThrow({
          where: { id: "demo-colleague" },
          select: { id: true, email: true }
        })
      ]);

      await client.researchProfile.update({
        where: { userId: solvi.id },
        data: {
          interestsJson: encodeJsonField(["stale interest"]),
          constraintsJson: encodeJsonField(["stale constraint"]),
          preferredOutputsJson: encodeJsonField(["stale output"]),
          rankingWeightsJson: encodeJsonField({
            paperQuality: 1,
            projectOpportunity: 0,
            dispatchLikelihood: 0
          }),
          arxivQuery: "stale query",
          maxDailyPapers: 1
        }
      });

      await seed(client);

      const [solviProfile, collaboratorProfile] = await Promise.all([
        client.researchProfile.findUniqueOrThrow({
          where: { userId: solvi.id },
          select: profileSelect
        }),
        client.researchProfile.findUniqueOrThrow({
          where: { userId: collaborator.id },
          select: profileSelect
        })
      ]);

      expect(solviProfile).toEqual(buildProfileSeedData());
      expect(collaboratorProfile).toEqual(buildProfileSeedData());
      expect(solvi.email).toBe("solvi@example.com");
      expect(collaborator.email).toBe("colleague@example.com");
    });
  });

  it("reuses an existing user with the canonical email when seeding", async () => {
    await withTestDatabase(async (client) => {
      await client.user.create({
        data: {
          id: "existing-solvi",
          email: "solvi@example.com",
          name: "Existing Solvi"
        }
      });
      await client.researchProfile.create({
        data: {
          userId: "existing-solvi",
          interestsJson: encodeJsonField(["stale interest"]),
          constraintsJson: encodeJsonField(["stale constraint"]),
          preferredOutputsJson: encodeJsonField(["stale output"]),
          rankingWeightsJson: encodeJsonField({
            paperQuality: 1,
            projectOpportunity: 0,
            dispatchLikelihood: 0
          }),
          arxivQuery: "stale query",
          maxDailyPapers: 1
        }
      });

      await seed(client);

      const [canonicalUser, staleIdUser, canonicalProfile, staleProfile] = await Promise.all([
        client.user.findUniqueOrThrow({
          where: { email: "solvi@example.com" },
          select: { id: true, name: true }
        }),
        client.user.findUnique({
          where: { id: "existing-solvi" },
          select: { id: true }
        }),
        client.researchProfile.findUniqueOrThrow({
          where: { userId: "demo-solvi" },
          select: profileSelect
        }),
        client.researchProfile.findUnique({
          where: { userId: "existing-solvi" },
          select: { userId: true }
        })
      ]);

      expect(canonicalUser).toEqual({ id: "demo-solvi", name: "Solvi" });
      expect(staleIdUser).toBeNull();
      expect(canonicalProfile).toEqual(buildProfileSeedData());
      expect(staleProfile).toBeNull();
    });
  });

  it("rolls back all seed writes when one user fails", async () => {
    await withTestDatabase(async (client) => {
      await expect(
        seed(client, [
          {
            id: "demo-solvi",
            email: "solvi@example.com",
            name: "Solvi"
          },
          {
            id: "demo-solvi",
            email: "colleague@example.com",
            name: "Conflicting Colleague"
          }
        ])
      ).rejects.toThrow();

      const [users, profiles] = await Promise.all([
        client.user.findMany(),
        client.researchProfile.findMany()
      ]);

      expect(users).toEqual([]);
      expect(profiles).toEqual([]);
    });
  });
});
