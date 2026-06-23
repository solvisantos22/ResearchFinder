import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

function buildSchemaUrl(schemaName: string): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error("TEST_DATABASE_URL must be set for Postgres-backed tests");
  }

  const url = new URL(base);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

function pushSchema(databaseUrl: string): void {
  const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");

  execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    },
    stdio: "ignore"
  });
}

export async function withPostgresTestDatabase(
  run: (client: PrismaClient) => Promise<void>
): Promise<void> {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = buildSchemaUrl(schemaName);
  const client = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    pushSchema(databaseUrl);
    await run(client);
  } finally {
    await client.$disconnect();

    const cleanup = new PrismaClient({
      datasourceUrl: buildSchemaUrl("public")
    });
    try {
      await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await cleanup.$disconnect();
    }
  }
}
