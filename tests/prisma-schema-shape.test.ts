import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

function modelBlock(modelName: string) {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));

  expect(match, `model ${modelName} should exist`).not.toBeNull();

  return match?.[0] ?? "";
}

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

  it("uses Auth.js Prisma adapter-compatible user and auth model shapes", () => {
    const user = modelBlock("User");
    const account = modelBlock("Account");
    const session = modelBlock("Session");
    const verificationToken = modelBlock("VerificationToken");

    expect(user).toMatch(/\bid\s+String\s+@id\s+@default\(cuid\(\)\)/);
    expect(user).toMatch(/\bname\s+String\?/);
    expect(user).toMatch(/\bemail\s+String\?\s+@unique/);
    expect(user).toMatch(/\bemailVerified\s+DateTime\?/);
    expect(user).toMatch(/\bimage\s+String\?/);
    expect(account).toContain("@@unique([provider, providerAccountId])");
    expect(session).toMatch(/\bsessionToken\s+String\s+@unique/);
    expect(verificationToken).toContain("@@unique([identifier, token])");
  });

  it("supports legacy and generated idea viability jobs", () => {
    const viabilityJob = modelBlock("ViabilityJob");

    expect(viabilityJob).toMatch(/\bideaId\s+String\?/);
    expect(viabilityJob).toMatch(
      /\bidea\s+Idea\?\s+@relation\(fields: \[ideaId\], references: \[id\], onDelete: Cascade\)/,
    );
    expect(viabilityJob).toMatch(
      /\bgeneratedIdea\s+GeneratedIdea\?\s+@relation\(fields: \[generatedIdeaId\], references: \[id\], onDelete: Cascade\)/,
    );
  });
});
