import { prisma } from "@/lib/db";
import { buildDailyInboxForUser } from "@/lib/inbox/service";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true } });
  const inboxDate = todayIsoDate();

  for (const user of users) {
    const items = await buildDailyInboxForUser(user.id, inboxDate);
    console.log(`Built ${items.length} inbox items for ${user.id} on ${inboxDate}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
