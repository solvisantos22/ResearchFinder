import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/db";
import { defaultRankingWeights } from "@/lib/domain";

export function encodeJsonField<T>(value: T): string {
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

type SeedUser = {
  email: string;
  name: string;
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

export async function seed(client: PrismaClient = prisma) {
  const users: SeedUser[] = [
    {
      email: "solvi@example.com",
      name: "Solvi"
    },
    {
      email: "colleague@example.com",
      name: "Research Collaborator"
    }
  ];

  await client.$transaction(async (tx) => {
    for (const user of users) {
      await seedUser(tx, user);
    }
  });
}

async function seedUser(tx: Prisma.TransactionClient, user: SeedUser) {
  const seededUser = await tx.user.upsert({
    where: { email: user.email },
    update: { name: user.name },
    create: {
      id: randomUUID(),
      email: user.email,
      name: user.name
    },
    select: { id: true }
  });
  const profileData = buildProfileSeedData();

  await tx.researchProfile.upsert({
    where: { userId: seededUser.id },
    update: profileData,
    create: {
      userId: seededUser.id,
      ...profileData
    }
  });
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
