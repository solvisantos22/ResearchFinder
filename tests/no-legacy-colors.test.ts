import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FORBIDDEN: RegExp[] = [
  /\b(?:bg|text|border|from|to|via|ring|divide|fill|stroke)-(?:slate|gray|zinc|neutral|stone|teal|emerald|sky|amber|rose|red|green|blue|indigo|cyan)-\d{2,3}\b/,
  /\b(?:bg|text|border)-white\b/,
  /\b(?:bg|text|border)-(?:ink|paper|line|accent)\b/,
  /\[color-scheme:light\]/
];

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full));
    } else if (full.endsWith(".tsx") || full.endsWith(".ts")) {
      files.push(full);
    }
  }

  return files;
}

describe("no legacy or off-brand color classes", () => {
  it("src/ uses only the rf design token system", () => {
    const offenders: string[] = [];

    for (const file of collectFiles(join(process.cwd(), "src"))) {
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        const match = content.match(pattern);
        if (match) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
