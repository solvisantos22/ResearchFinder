import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("v2 prisma schema shape", () => {
  it("uses postgresql provider", () => {
    expect(schema).toContain('provider = "postgresql"');
  });

  it("defines hosted auth, worker, inbox generation, and citation models", () => {
    for (const modelName of [
      "Account",
      "Session",
      "VerificationToken",
      "AllowedEmail",
      "FieldPreset",
      "PaperSource",
      "CandidateBatch",
      "CandidatePaper",
      "InboxGenerationJob",
      "GeneratedIdea",
      "IdeaCitation",
      "WorkerRegistration",
      "WorkerJobLog",
    ]) {
      expect(schema).toContain(`model ${modelName} `);
    }
  });
});
