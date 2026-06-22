import { pathToFileURL } from "node:url";

import { prisma } from "@/lib/db";
import { processNextViabilityJob } from "@/lib/viability/service";

async function main() {
  const jobId = await processNextViabilityJob();

  if (jobId) {
    console.log(`Processed viability job ${jobId}`);
    return;
  }

  console.log("No queued viability jobs");
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
