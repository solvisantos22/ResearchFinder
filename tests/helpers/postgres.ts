import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

type ExecFileFailure = Error & {
  stdout?: unknown;
  stderr?: unknown;
  status?: unknown;
  signal?: unknown;
};

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
  const args = [prismaCli, "db", "push", "--skip-generate"];

  try {
    execFileSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl
      },
      stdio: "pipe"
    });
  } catch (error) {
    const failure = error as ExecFileFailure;
    const stdout = outputToString(failure.stdout);
    const stderr = outputToString(failure.stderr);
    const details = [
      "Prisma db push failed for Postgres-backed tests.",
      `Command: ${process.execPath} ${args.join(" ")}`,
      typeof failure.status === "number" ? `Exit status: ${failure.status}` : undefined,
      typeof failure.signal === "string" ? `Signal: ${failure.signal}` : undefined,
      stdout ? `stdout:\n${stdout}` : undefined,
      stderr ? `stderr:\n${stderr}` : undefined
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n\n");

    throw new Error(details, { cause: error });
  }
}

function outputToString(output: unknown): string {
  if (Buffer.isBuffer(output)) {
    return output.toString("utf8").trim();
  }

  if (typeof output === "string") {
    return output.trim();
  }

  return "";
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

function logSuppressedCleanupError(error: unknown): void {
  process.stderr.write(
    `Suppressed Postgres test database cleanup error after primary failure:\n${formatUnknownError(
      error
    )}\n`
  );
}

async function dropTestSchema(schemaName: string): Promise<void> {
  const cleanup = new PrismaClient({
    datasourceUrl: buildSchemaUrl("public")
  });
  let dropError: unknown;

  try {
    await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } catch (error) {
    dropError = error;
    throw error;
  } finally {
    try {
      await cleanup.$disconnect();
    } catch (disconnectError) {
      if (dropError) {
        process.stderr.write(
          `Suppressed Postgres cleanup-client disconnect error after schema cleanup failure:\n${formatUnknownError(
            disconnectError
          )}\n`
        );
      } else {
        throw disconnectError;
      }
    }
  }
}

export async function withPostgresTestDatabase(
  run: (client: PrismaClient) => Promise<void>
): Promise<void> {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = buildSchemaUrl(schemaName);
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  let primaryError: unknown;

  try {
    pushSchema(databaseUrl);
    await run(client);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let cleanupError: unknown;

    try {
      await client.$disconnect();
    } catch (error) {
      cleanupError ??= error;
    }

    try {
      await dropTestSchema(schemaName);
    } catch (error) {
      cleanupError ??= error;
    }

    if (cleanupError) {
      if (primaryError) {
        logSuppressedCleanupError(cleanupError);
      } else {
        throw cleanupError;
      }
    }
  }
}
