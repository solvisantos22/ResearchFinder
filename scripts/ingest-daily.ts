import { pathToFileURL } from "node:url";

import { prisma } from "@/lib/db";
import { buildDailyInboxForUser } from "@/lib/inbox/service";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function buildProfiledUserQuery() {
  return {
    where: { profile: { isNot: null } },
    select: { id: true }
  } as const;
}

async function main() {
  const users = await prisma.user.findMany(buildProfiledUserQuery());
  const inboxDate = todayIsoDate();

  for (const user of users) {
    const items = await buildDailyInboxForUser(user.id, inboxDate);
    console.log(`Built ${items.length} inbox items for ${user.id} on ${inboxDate}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
