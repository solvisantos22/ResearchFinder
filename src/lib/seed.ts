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
  id: string;
  email: string;
  name: string;
  interests: string[];
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

const defaultSeedUsers: SeedUser[] = [
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
    email: "collaborator@example.com",
    name: "Research Collaborator",
    interests: [
      "automated research agents",
      "scientific discovery systems",
      "evaluation harnesses",
      "paper reproduction"
    ]
  }
];

export async function seed(
  client: PrismaClient = prisma,
  users: SeedUser[] = defaultSeedUsers
) {
  await client.$transaction(async (tx) => {
    for (const user of users) {
      await seedUser(tx, user);
    }
  });
}

async function seedUser(tx: Prisma.TransactionClient, user: SeedUser) {
  const [userById, userByEmail] = await Promise.all([
    tx.user.findUnique({
      where: { id: user.id },
      select: { id: true }
    }),
    tx.user.findUnique({
      where: { email: user.email },
      select: { id: true }
    })
  ]);

  if (userById && userByEmail && userById.id !== userByEmail.id) {
    throw new Error(
      `Cannot seed ${user.email}: canonical id ${user.id} and email belong to different users`
    );
  }

  const existingUser = userByEmail ?? userById;
  const seededUser = existingUser
    ? await tx.user.update({
        where: { id: existingUser.id },
        data: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        select: { id: true }
      })
    : await tx.user.create({
        data: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        select: { id: true }
      });
  const profileData = buildProfileSeedData(user.interests);

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
