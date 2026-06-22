import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
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

afterAll(async () => {
  await prisma.$disconnect();
});

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
    await seed();

    try {
      await prisma.researchProfile.update({
        where: { userId: "demo-solvi" },
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

      await seed();

      const [solviProfile, collaboratorProfile, collaborator] = await Promise.all([
        prisma.researchProfile.findUniqueOrThrow({
          where: { userId: "demo-solvi" },
          select: profileSelect
        }),
        prisma.researchProfile.findUniqueOrThrow({
          where: { userId: "demo-collaborator" },
          select: profileSelect
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: "demo-collaborator" },
          select: { email: true }
        })
      ]);

      expect(solviProfile).toEqual(buildProfileSeedData());
      expect(collaboratorProfile).toEqual(buildProfileSeedData());
      expect(collaborator.email).toBe("colleague@example.com");
    } finally {
      await seed();
    }
  });
});
