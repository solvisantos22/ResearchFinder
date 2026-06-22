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

export function buildProfileSeedData(interests: string[]): ProfileSeedData {
  return {
    interestsJson: encodeJsonField(interests),
    constraintsJson: encodeJsonField([
      "Prefer credible prototypes in 1-3 weeks",
      "Prefer projects that can become papers after experiments",
      "Avoid frontier-scale model training"
    ]),
    preferredOutputsJson: encodeJsonField([
      "benchmark",
      "evaluation harness",
      "open-source tool",
      "paper with reproducible experiments"
    ]),
    rankingWeightsJson: encodeJsonField(defaultRankingWeights),
    arxivQuery:
      "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND (all:LLM OR all:evaluation OR all:agent OR all:benchmark OR all:reasoning)",
    maxDailyPapers: 10
  };
}

export async function seed() {
  const users = [
    {
      id: "demo-solvi",
      email: "solvi@example.com",
      name: "Solvi",
      interests: [
        "LLM evaluation",
        "multi-agent systems",
        "benchmark design",
        "agentic research workflows",
        "reasoning under constraints"
      ]
    },
    {
      id: "demo-collaborator",
      email: "colleague@example.com",
      name: "Research Collaborator",
      interests: [
        "automated research agents",
        "scientific discovery systems",
        "evaluation harnesses",
        "paper reproduction"
      ]
    }
  ];

  for (const user of users) {
    const profileData = buildProfileSeedData(user.interests);

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
