import { pathToFileURL } from "node:url";

import { prisma } from "@/lib/db";
import { defaultRankingWeights } from "@/lib/domain";

export function encodeJsonField(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJsonField<T>(value: string): T {
  return JSON.parse(value) as T;
}

type ProfileSeedData = {
  interestsJson: string;
  constraintsJson: string;
  preferredOutputsJson: string;
  rankingWeightsJson: string;
  arxivQuery: string;
  maxDailyPapers: number;
};

const canonicalInterests = [
  "mechanistic interpretability",
  "reasoning evals",
  "agent evaluation",
  "AI safety"
];

export function buildProfileSeedData(): ProfileSeedData {
  return {
    interestsJson: encodeJsonField(canonicalInterests),
    constraintsJson: encodeJsonField([
      "one-week prototype",
      "open-source models preferred"
    ]),
    preferredOutputsJson: encodeJsonField([
      "prototype",
      "paper draft"
    ]),
    rankingWeightsJson: encodeJsonField(defaultRankingWeights),
    arxivQuery: "cat:cs.AI OR cat:cs.CL OR cat:cs.LG",
    maxDailyPapers: 10
  };
}

export async function seed() {
  const users = [
    {
      id: "demo-solvi",
      email: "solvi@example.com",
      name: "Solvi"
    },
    {
      id: "demo-collaborator",
      email: "colleague@example.com",
      name: "Research Collaborator"
    }
  ];

  for (const user of users) {
    const profileData = buildProfileSeedData();

    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        name: user.name
      },
      create: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });

    await prisma.researchProfile.upsert({
      where: { userId: user.id },
      update: profileData,
      create: {
        userId: user.id,
        ...profileData
      }
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed()
    .then(async () => {
      await prisma.$disconnect();
      console.log("Seeded Research Finder users and profiles");
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
