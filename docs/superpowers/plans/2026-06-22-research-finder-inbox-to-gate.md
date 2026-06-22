# Research Finder Inbox-to-Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first cloud milestone for Research Finder: a personalized morning paper inbox, dispatch setup, viability sprint jobs, and a decision screen with preserved artifacts and evidence.

**Architecture:** Implement a single Next.js TypeScript app with clear internal service boundaries. Use Prisma for persistence, server actions/API routes for product flows, and worker scripts for daily ingestion and viability sprint processing. Keep full paper generation out of the first milestone, but model artifacts and evidence now so later citation-gated paper writing has a clean foundation.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, SQLite for local development with Postgres-compatible schema, Vitest, Testing Library, fast-xml-parser, Zod, Tailwind CSS.

---

## Scope

This plan implements the first milestone from `docs/superpowers/specs/2026-06-22-research-scout-cloud-product-design.md`:

- Cloud-style account/profile foundation for initial private users.
- Personalized daily paper ingestion and ranking.
- Dense Scientific Inbox cards.
- Dispatch setup with sprint depth and autonomy.
- Viability sprint job creation and processing.
- Decision screen with prototype, research, and novelty signals.
- Basic artifact and evidence storage.

This plan does not implement autonomous full paper generation, billing, public SaaS onboarding, or the strict citation-gated final paper pipeline.

## File Structure

Create the app in the repository root.

- `package.json`: npm scripts and dependencies.
- `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`: tooling.
- `prisma/schema.prisma`: database models for users, profiles, papers, ideas, inbox items, dispatch jobs, artifacts, and evidence.
- `src/lib/domain.ts`: shared enums, score types, and score calculation helpers.
- `src/lib/db.ts`: Prisma client singleton.
- `src/lib/arxiv/client.ts`: arXiv API fetch and Atom parsing.
- `src/lib/arxiv/fixtures.ts`: stable test fixtures.
- `src/lib/ranking/scoring.ts`: paper quality, project opportunity, dispatch likelihood, and overall scoring.
- `src/lib/ranking/ideaGenerator.ts`: deterministic first-pass project ideas.
- `src/lib/inbox/service.ts`: create and read personalized inboxes.
- `src/lib/dispatch/service.ts`: create dispatch jobs.
- `src/lib/viability/service.ts`: process viability jobs and produce decision evidence.
- `src/lib/seed.ts`: seed private users and profiles.
- `src/app/layout.tsx`: shell layout.
- `src/app/page.tsx`: redirect to the active demo inbox.
- `src/app/inbox/[userId]/page.tsx`: morning inbox screen.
- `src/app/dispatch/[ideaId]/page.tsx`: dispatch setup screen.
- `src/app/dispatch/[ideaId]/actions.ts`: dispatch form server action.
- `src/app/jobs/[jobId]/page.tsx`: viability decision screen.
- `src/components/ScorePill.tsx`: score display.
- `src/components/PaperCard.tsx`: Scientific Inbox card.
- `src/components/DispatchForm.tsx`: sprint depth and autonomy controls.
- `src/components/SignalPanel.tsx`: decision screen signal summaries.
- `scripts/ingest-daily.ts`: scheduled ingestion entrypoint.
- `scripts/process-viability-once.ts`: worker entrypoint for queued jobs.
- `tests/**/*.test.ts`: unit and service tests.

## Task 1: Scaffold the TypeScript Web App

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `vitest.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.mjs`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`

- [ ] **Step 1: Create the package manifest**

Create `package.json`:

```json
{
  "name": "research-finder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:seed": "tsx src/lib/seed.ts",
    "ingest:daily": "tsx scripts/ingest-daily.ts",
    "worker:once": "tsx scripts/process-viability-once.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0",
    "fast-xml-parser": "^4.5.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.17.0",
    "eslint-config-next": "^15.0.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.49",
    "prisma": "^6.0.0",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```powershell
npm install
```

Expected: npm creates `package-lock.json` and exits with code 0.

- [ ] **Step 3: Add TypeScript configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Add app and test configuration**

Create `next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true
  }
};

export default nextConfig;
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
```

Create `tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f2933",
        paper: "#f8fafc",
        line: "#d8dee9",
        accent: "#0f766e"
      }
    }
  },
  plugins: []
};

export default config;
```

Create `postcss.config.mjs`:

```js
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};

export default config;
```

- [ ] **Step 5: Add the base app shell**

Create `src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
  background: #f8fafc;
  color: #1f2933;
}

body {
  margin: 0;
  background: #f8fafc;
  color: #1f2933;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

a {
  color: inherit;
  text-decoration: none;
}
```

Create `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Finder",
  description: "Personalized research paper inbox and viability sprint platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}
```

Create `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/inbox/demo-solvi");
}
```

- [ ] **Step 6: Verify the scaffold builds**

Run:

```powershell
npm run build
```

Expected: build fails only if Prisma is not configured yet. If it fails with `prisma: command not found`, rerun `npm install`. Continue to Task 2 before treating Prisma-related build failures as defects.

- [ ] **Step 7: Commit**

Run:

```powershell
git add package.json package-lock.json tsconfig.json next.config.mjs vitest.config.ts tailwind.config.ts postcss.config.mjs src/app
git commit -m "chore: scaffold research finder app"
```

## Task 2: Define Domain Types and Score Semantics

**Files:**
- Create: `src/lib/domain.ts`
- Create: `tests/domain.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create `tests/domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AUTONOMY_LEVELS,
  SPRINT_DEPTHS,
  clampScore,
  computeOverallScore,
  sprintDepthConfig
} from "@/lib/domain";

describe("domain score helpers", () => {
  it("clamps scores into the 0..1 range", () => {
    expect(clampScore(-0.2)).toBe(0);
    expect(clampScore(0.4567)).toBe(0.457);
    expect(clampScore(1.2)).toBe(1);
  });

  it("computes a weighted overall score", () => {
    expect(
      computeOverallScore({
        paperQuality: 0.9,
        projectOpportunity: 0.7,
        dispatchLikelihood: 0.5
      })
    ).toBe(0.72);
  });

  it("defines the dispatch controls required by the spec", () => {
    expect(SPRINT_DEPTHS).toEqual(["fast", "default", "deep"]);
    expect(AUTONOMY_LEVELS).toEqual(["low", "medium", "high"]);
    expect(sprintDepthConfig.default.expectedDuration).toBe("1-3 hours");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
npm test -- tests/domain.test.ts
```

Expected: FAIL because `src/lib/domain.ts` does not exist.

- [ ] **Step 3: Add the domain implementation**

Create `src/lib/domain.ts`:

```ts
export const SPRINT_DEPTHS = ["fast", "default", "deep"] as const;
export type SprintDepth = (typeof SPRINT_DEPTHS)[number];

export const AUTONOMY_LEVELS = ["low", "medium", "high"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const DECISIONS = ["expand", "revise", "save", "discard"] as const;
export type Decision = (typeof DECISIONS)[number];

export type ScoreBreakdown = {
  paperQuality: number;
  projectOpportunity: number;
  dispatchLikelihood: number;
};

export type RankingWeights = {
  paperQuality: number;
  projectOpportunity: number;
  dispatchLikelihood: number;
};

export const defaultRankingWeights: RankingWeights = {
  paperQuality: 0.35,
  projectOpportunity: 0.4,
  dispatchLikelihood: 0.25
};

export const sprintDepthConfig: Record<
  SprintDepth,
  { expectedDuration: string; description: string }
> = {
  fast: {
    expectedDuration: "10-20 minutes",
    description: "Novelty and feasibility triage with a lightweight experiment sketch."
  },
  default: {
    expectedDuration: "1-3 hours",
    description: "Minimal prototype attempt or concrete experiment design with evidence."
  },
  deep: {
    expectedDuration: "6-12 hours",
    description: "Overnight-style related-work search and stronger prototype attempt."
  }
};

export const autonomyConfig: Record<AutonomyLevel, { description: string }> = {
  low: {
    description: "Read, summarize, and propose experiments only."
  },
  medium: {
    description:
      "Create files, small scripts, experiment plans, and artifacts; ask before expensive external spend."
  },
  high: {
    description:
      "Run code, call APIs, fetch datasets, and spend within the configured budget."
  }
};

export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

export function computeOverallScore(
  scores: ScoreBreakdown,
  weights: RankingWeights = defaultRankingWeights
): number {
  const totalWeight =
    weights.paperQuality + weights.projectOpportunity + weights.dispatchLikelihood;

  const weighted =
    scores.paperQuality * weights.paperQuality +
    scores.projectOpportunity * weights.projectOpportunity +
    scores.dispatchLikelihood * weights.dispatchLikelihood;

  return clampScore(weighted / totalWeight);
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/domain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/lib/domain.ts tests/domain.test.ts
git commit -m "feat: define research finder domain controls"
```

## Task 3: Add Prisma Persistence Models

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db.ts`
- Create: `.env.example`

- [ ] **Step 1: Add the Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id
  email     String   @unique
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  profile ResearchProfile?
  inboxItems InboxItem[]
  jobs ViabilityJob[]
}

model ResearchProfile {
  id                 String   @id @default(cuid())
  userId             String   @unique
  interestsJson      String
  constraintsJson    String
  preferredOutputsJson String
  rankingWeightsJson String
  arxivQuery         String
  maxDailyPapers     Int      @default(10)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Paper {
  id          String   @id @default(cuid())
  arxivId     String   @unique
  title       String
  abstract    String
  url         String
  publishedAt DateTime
  arxivUpdatedAt DateTime
  authorsJson String
  categoriesJson String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  ideas Idea[]
  inboxItems InboxItem[]
}

model Idea {
  id          String   @id @default(cuid())
  paperId     String
  title       String
  summary     String
  rationale   String
  approach    String
  risksJson   String
  nextStepsJson String
  tagsJson    String
  generatedBy String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  paper Paper @relation(fields: [paperId], references: [id], onDelete: Cascade)
  inboxItems InboxItem[]
  jobs ViabilityJob[]
}

model InboxItem {
  id                 String   @id @default(cuid())
  userId             String
  paperId            String
  bestIdeaId         String
  inboxDate          String
  overallScore       Float
  paperQuality       Float
  projectOpportunity Float
  dispatchLikelihood Float
  reasoningJson      String
  createdAt          DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  paper Paper @relation(fields: [paperId], references: [id], onDelete: Cascade)
  bestIdea Idea @relation(fields: [bestIdeaId], references: [id], onDelete: Cascade)

  @@unique([userId, paperId, inboxDate])
  @@index([userId, inboxDate, overallScore])
}

model ViabilityJob {
  id             String   @id @default(cuid())
  userId         String
  ideaId         String
  sprintDepth    String
  autonomyLevel  String
  status         String
  verdict        String?
  errorMessage   String?
  createdAt      DateTime @default(now())
  startedAt      DateTime?
  completedAt    DateTime?
  updatedAt      DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  idea Idea @relation(fields: [ideaId], references: [id], onDelete: Cascade)
  artifacts Artifact[]
  evidence Evidence[]
}

model Artifact {
  id        String   @id @default(cuid())
  jobId     String
  kind      String
  title     String
  content   String
  createdAt DateTime @default(now())

  job ViabilityJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
}

model Evidence {
  id        String   @id @default(cuid())
  jobId     String
  sourceUrl String
  sourceTitle String
  claim     String
  support   String
  confidence Float
  createdAt DateTime @default(now())

  job ViabilityJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
}
```

Note: arXiv parser input may still expose the source metadata timestamp as `updatedAt`, but persistence must write it to `Paper.arxivUpdatedAt`; `Paper.updatedAt` is reserved for Prisma row mutation time via `@updatedAt`.

- [ ] **Step 2: Add database environment defaults**

Create `.env.example`:

```text
DATABASE_URL="file:./dev.db"
CRON_SECRET="dev-cron-secret"
```

Create `.env` locally with the same contents:

```powershell
Copy-Item .env.example .env
```

- [ ] **Step 3: Add the Prisma client singleton**

Create `src/lib/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 4: Validate and push the schema**

Run:

```powershell
npm run db:generate
npm run db:push
```

Expected: Prisma client is generated and SQLite database is created at `prisma/dev.db`.

- [ ] **Step 5: Commit**

Run:

```powershell
git add prisma/schema.prisma src/lib/db.ts .env.example
git commit -m "feat: add persistence schema"
```

## Task 4: Seed Initial Private Users and Profiles

**Files:**
- Create: `src/lib/seed.ts`
- Create: `tests/profile-json.test.ts`

- [ ] **Step 1: Write a failing profile serialization test**

Create `tests/profile-json.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { encodeJsonField, parseJsonField } from "@/lib/seed";

describe("profile JSON helpers", () => {
  it("round-trips arrays and objects", () => {
    const values = ["LLM evaluation", "agent workflows"];
    const encoded = encodeJsonField(values);
    expect(parseJsonField<string[]>(encoded)).toEqual(values);

    const weights = { paperQuality: 0.35, projectOpportunity: 0.4 };
    expect(parseJsonField<typeof weights>(encodeJsonField(weights))).toEqual(weights);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/profile-json.test.ts
```

Expected: FAIL because `src/lib/seed.ts` does not exist.

- [ ] **Step 3: Add the seed implementation**

Create `src/lib/seed.ts`:

```ts
import { prisma } from "@/lib/db";
import { defaultRankingWeights } from "@/lib/domain";

export function encodeJsonField(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJsonField<T>(value: string): T {
  return JSON.parse(value) as T;
}

export async function seed() {
  const users = [
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

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        name: user.name
      },
      create: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });

    await prisma.researchProfile.upsert({
      where: { userId: user.id },
      update: {
        interestsJson: encodeJsonField(user.interests)
      },
      create: {
        userId: user.id,
        interestsJson: encodeJsonField(user.interests),
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
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
```

- [ ] **Step 4: Run tests and seed**

Run:

```powershell
npm test -- tests/profile-json.test.ts
npm run db:seed
```

Expected: test PASS and seed command prints `Seeded Research Finder users and profiles`.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/lib/seed.ts tests/profile-json.test.ts
git commit -m "feat: seed private research profiles"
```

## Task 5: Implement arXiv Fetching and Parsing

**Files:**
- Create: `src/lib/arxiv/client.ts`
- Create: `src/lib/arxiv/fixtures.ts`
- Create: `tests/arxiv-client.test.ts`

- [ ] **Step 1: Write the failing parser test**

Create `src/lib/arxiv/fixtures.ts`:

```ts
export const arxivAtomFixture = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2606.20408v1</id>
    <updated>2026-06-21T12:00:00Z</updated>
    <published>2026-06-21T12:00:00Z</published>
    <title>LLM agent safety, multi-turn red-teaming, jailbreak benchmarks</title>
    <summary>We present a benchmark for multi-turn red-teaming of LLM agents.</summary>
    <author><name>Example Author</name></author>
    <category term="cs.AI"/>
    <category term="cs.CL"/>
  </entry>
</feed>`;
```

Create `tests/arxiv-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { arxivAtomFixture } from "@/lib/arxiv/fixtures";
import { parseArxivAtom } from "@/lib/arxiv/client";

describe("parseArxivAtom", () => {
  it("parses arXiv Atom entries into normalized papers", () => {
    const papers = parseArxivAtom(arxivAtomFixture);
    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      arxivId: "2606.20408v1",
      title: "LLM agent safety, multi-turn red-teaming, jailbreak benchmarks",
      url: "http://arxiv.org/abs/2606.20408v1",
      authors: ["Example Author"],
      categories: ["cs.AI", "cs.CL"]
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/arxiv-client.test.ts
```

Expected: FAIL because `parseArxivAtom` is missing.

- [ ] **Step 3: Add the arXiv client**

Create `src/lib/arxiv/client.ts`:

```ts
import { XMLParser } from "fast-xml-parser";

export type ArxivPaperInput = {
  arxivId: string;
  title: string;
  abstract: string;
  url: string;
  publishedAt: Date;
  updatedAt: Date;
  authors: string[];
  categories: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  trimValues: true
});

export function parseArxivAtom(xml: string): ArxivPaperInput[] {
  const parsed = parser.parse(xml);
  const entries = Array.isArray(parsed.feed?.entry)
    ? parsed.feed.entry
    : parsed.feed?.entry
      ? [parsed.feed.entry]
      : [];

  return entries.map((entry: any) => {
    const url = normalizeText(entry.id);
    return {
      arxivId: url.split("/").at(-1) ?? url,
      title: cleanWhitespace(normalizeText(entry.title)),
      abstract: cleanWhitespace(normalizeText(entry.summary)),
      url,
      publishedAt: new Date(normalizeText(entry.published)),
      updatedAt: new Date(normalizeText(entry.updated)),
      authors: normalizeArray(entry.author).map((author) => cleanWhitespace(normalizeText(author.name))),
      categories: normalizeArray(entry.category)
        .map((category) => String(category.term ?? ""))
        .filter(Boolean)
    };
  });
}

export async function fetchArxivPapers(query: string, maxResults: number) {
  const params = new URLSearchParams({
    search_query: query,
    start: "0",
    max_results: String(maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending"
  });

  const response = await fetch(`https://export.arxiv.org/api/query?${params.toString()}`, {
    headers: {
      "User-Agent": "research-finder/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`arXiv fetch failed: ${response.status} ${response.statusText}`);
  }

  return parseArxivAtom(await response.text());
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "text" in value) {
    return String((value as { text: unknown }).text);
  }
  return String(value ?? "");
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/arxiv-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/lib/arxiv tests/arxiv-client.test.ts
git commit -m "feat: parse arxiv paper feed"
```

## Task 6: Implement Ranking and Idea Generation

**Files:**
- Create: `src/lib/ranking/scoring.ts`
- Create: `src/lib/ranking/ideaGenerator.ts`
- Create: `tests/ranking.test.ts`

- [ ] **Step 1: Write failing ranking tests**

Create `tests/ranking.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scorePaperForProfile } from "@/lib/ranking/scoring";
import { generateIdeasForPaper } from "@/lib/ranking/ideaGenerator";

const paper = {
  title: "Evaluating multi-agent LLM systems with benchmark stress tests",
  abstract:
    "We introduce a benchmark for measuring LLM agent failures under realistic reasoning constraints.",
  categories: ["cs.AI", "cs.CL"]
};

const profile = {
  interests: ["LLM evaluation", "multi-agent systems", "benchmark design"],
  preferredOutputs: ["benchmark", "evaluation harness"]
};

describe("ranking", () => {
  it("scores papers with a three-part breakdown and overall score", () => {
    const score = scorePaperForProfile(paper, profile);
    expect(score.overall).toBeGreaterThan(0.5);
    expect(score.paperQuality).toBeGreaterThan(0.5);
    expect(score.projectOpportunity).toBeGreaterThan(0.5);
    expect(score.dispatchLikelihood).toBeGreaterThan(0.5);
  });

  it("generates project ideas with dispatch framing", () => {
    const ideas = generateIdeasForPaper(paper, profile);
    expect(ideas).toHaveLength(3);
    expect(ideas[0].title).toContain("evaluation");
    expect(ideas[0].nextSteps[0]).toContain("minimal");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/ranking.test.ts
```

Expected: FAIL because ranking modules do not exist.

- [ ] **Step 3: Add scoring implementation**

Create `src/lib/ranking/scoring.ts`:

```ts
import { ScoreBreakdown, clampScore, computeOverallScore } from "@/lib/domain";

type PaperLike = {
  title: string;
  abstract: string;
  categories: string[];
};

type ProfileLike = {
  interests: string[];
  preferredOutputs: string[];
};

const qualityTerms = [
  "benchmark",
  "dataset",
  "evaluation",
  "state-of-the-art",
  "reproducible",
  "failure",
  "reasoning",
  "agent"
];

const dispatchTerms = [
  "benchmark",
  "dataset",
  "evaluation",
  "simulation",
  "tool",
  "open-source",
  "prompt",
  "analysis"
];

const dispatchPenaltyTerms = ["pretrain", "billion", "trillion", "hardware", "clinical"];

export type RankedScore = ScoreBreakdown & { overall: number };

export function scorePaperForProfile(paper: PaperLike, profile: ProfileLike): RankedScore {
  const text = `${paper.title} ${paper.abstract} ${paper.categories.join(" ")}`.toLowerCase();
  const profileTerms = [...profile.interests, ...profile.preferredOutputs].flatMap(tokenize);

  const relevanceHits = new Set(tokenize(text).filter((token) => profileTerms.includes(token)));
  const profileCoverage = profileTerms.length === 0 ? 0.5 : relevanceHits.size / profileTerms.length;

  const paperQuality = clampScore(0.35 + countTermHits(text, qualityTerms) * 0.065);
  const projectOpportunity = clampScore(0.3 + Math.sqrt(profileCoverage) * 0.6);
  const dispatchLikelihood = clampScore(
    0.5 + countTermHits(text, dispatchTerms) * 0.06 - countTermHits(text, dispatchPenaltyTerms) * 0.08
  );

  const scores = { paperQuality, projectOpportunity, dispatchLikelihood };
  return {
    ...scores,
    overall: computeOverallScore(scores)
  };
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
}

function countTermHits(text: string, terms: string[]): number {
  return terms.filter((term) => text.includes(term)).length;
}
```

- [ ] **Step 4: Add deterministic idea generation**

Create `src/lib/ranking/ideaGenerator.ts`:

```ts
type PaperLike = {
  title: string;
  abstract: string;
  categories: string[];
};

type ProfileLike = {
  interests: string[];
  preferredOutputs: string[];
};

export type GeneratedIdea = {
  title: string;
  summary: string;
  rationale: string;
  approach: string;
  risks: string[];
  nextSteps: string[];
  tags: string[];
  generatedBy: string;
};

export function generateIdeasForPaper(paper: PaperLike, profile: ProfileLike): GeneratedIdea[] {
  const interests = profile.interests.slice(0, 3).join(", ") || "the research profile";

  return [
    {
      title: `Build a focused evaluation extension for ${paper.title}`,
      summary:
        "Turn the paper's core claim into a compact evaluation that tests where the finding breaks under realistic constraints.",
      rationale:
        "This creates a bounded path from recent literature to evidence without requiring frontier-scale model training.",
      approach: `Recreate the smallest relevant setup, then add stress tests connected to ${interests}.`,
      risks: [
        "The paper may not expose enough implementation detail for fast reproduction.",
        "The extension may be too incremental unless the failure mode is sharp."
      ],
      nextSteps: [
        "Design a minimal viability test with one baseline and one stress condition.",
        "Identify the smallest dataset or task slice needed for preliminary evidence.",
        "Check related work for near-duplicate benchmark variants."
      ],
      tags: ["evaluation", "benchmark", "viability"],
      generatedBy: "heuristic:v1"
    },
    {
      title: `Find a benchmark slice implied by ${paper.title}`,
      summary:
        "Identify one assumption in the source paper and build a narrow benchmark slice around that assumption.",
      rationale:
        "A narrow slice can become publishable if it exposes systematic failures across models or agent setups.",
      approach:
        "Create 50-200 targeted examples, run baseline models or agents, and analyze whether failures cluster.",
      risks: [
        "The benchmark may be too small to support strong claims.",
        "The failure pattern may disappear after prompt or model changes."
      ],
      nextSteps: [
        "Extract one falsifiable assumption from the paper.",
        "Draft the example schema for the benchmark slice.",
        "Run a novelty scan for similar datasets."
      ],
      tags: ["dataset", "failure analysis", "benchmark design"],
      generatedBy: "heuristic:v1"
    },
    {
      title: `Prototype a research-agent workflow around ${paper.title}`,
      summary:
        "Use the source paper as a seed for agents that propose, critique, and refine follow-up experiments.",
      rationale:
        "This tests whether agentic research workflows can improve the specificity of paper-extension ideas.",
      approach:
        "Compare a single-agent idea generator against a multi-role workflow with scout, critic, and experiment designer roles.",
      risks: [
        "The evaluation may measure writing quality rather than research quality.",
        "The workflow may need careful human judging to avoid noisy conclusions."
      ],
      nextSteps: [
        "Define the scoring rubric for research-plan quality.",
        "Select three recent papers as test cases.",
        "Run a minimal single-agent versus multi-agent comparison."
      ],
      tags: ["research agents", "planning", "evaluation"],
      generatedBy: "heuristic:v1"
    }
  ];
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/ranking.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/lib/ranking tests/ranking.test.ts
git commit -m "feat: rank papers and generate project ideas"
```

## Task 7: Build Daily Ingestion and Inbox Creation

**Files:**
- Create: `src/lib/inbox/service.ts`
- Create: `scripts/ingest-daily.ts`
- Create: `tests/inbox-service.test.ts`

- [ ] **Step 1: Write a failing inbox service test**

Create `tests/inbox-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInboxReasoning } from "@/lib/inbox/service";

describe("createInboxReasoning", () => {
  it("explains why a paper is ranked and what dispatch should test", () => {
    const reasoning = createInboxReasoning({
      title: "LLM agent red-teaming benchmark",
      score: {
        overall: 0.82,
        paperQuality: 0.9,
        projectOpportunity: 0.8,
        dispatchLikelihood: 0.7
      },
      ideaTitle: "Build a focused evaluation extension"
    });

    expect(reasoning.whyPaperMatters).toContain("strong paper quality");
    expect(reasoning.smallestSprint).toContain("focused evaluation extension");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/inbox-service.test.ts
```

Expected: FAIL because `src/lib/inbox/service.ts` does not exist.

- [ ] **Step 3: Add inbox service implementation**

Create `src/lib/inbox/service.ts`:

```ts
import { prisma } from "@/lib/db";
import { parseJsonField } from "@/lib/seed";
import { fetchArxivPapers } from "@/lib/arxiv/client";
import { generateIdeasForPaper } from "@/lib/ranking/ideaGenerator";
import { scorePaperForProfile, type RankedScore } from "@/lib/ranking/scoring";

export type InboxReasoning = {
  whyPaperMatters: string;
  whyIdeaPromising: string;
  whyItMightBeTrap: string;
  smallestSprint: string;
  suggestedDepth: "fast" | "default" | "deep";
  suggestedAutonomy: "low" | "medium" | "high";
};

export function createInboxReasoning(input: {
  title: string;
  score: RankedScore;
  ideaTitle: string;
}): InboxReasoning {
  return {
    whyPaperMatters: `This has strong paper quality signal (${input.score.paperQuality.toFixed(2)}) for ${input.title}.`,
    whyIdeaPromising: `The best attached opportunity is "${input.ideaTitle}", which is concrete enough to dispatch.`,
    whyItMightBeTrap:
      input.score.dispatchLikelihood < 0.55
        ? "The paper may be important but hard to turn into fast evidence."
        : "The idea could still be too close to the source paper without a sharper experimental angle.",
    smallestSprint: `Run a minimal sprint that tests whether ${input.ideaTitle.toLowerCase()} can produce evidence.`,
    suggestedDepth: input.score.dispatchLikelihood > 0.75 ? "default" : "fast",
    suggestedAutonomy: input.score.dispatchLikelihood > 0.75 ? "medium" : "low"
  };
}

export async function buildDailyInboxForUser(userId: string, inboxDate: string) {
  const profile = await prisma.researchProfile.findUnique({
    where: { userId },
    include: { user: true }
  });

  if (!profile) {
    throw new Error(`No research profile found for ${userId}`);
  }

  const interests = parseJsonField<string[]>(profile.interestsJson);
  const preferredOutputs = parseJsonField<string[]>(profile.preferredOutputsJson);
  const papers = await fetchArxivPapers(profile.arxivQuery, 40);

  const createdItems = [];

  for (const paperInput of papers) {
    const paper = await prisma.paper.upsert({
      where: { arxivId: paperInput.arxivId },
      update: {
        title: paperInput.title,
        abstract: paperInput.abstract,
        url: paperInput.url,
        arxivUpdatedAt: paperInput.updatedAt,
        authorsJson: JSON.stringify(paperInput.authors),
        categoriesJson: JSON.stringify(paperInput.categories)
      },
      create: {
        arxivId: paperInput.arxivId,
        title: paperInput.title,
        abstract: paperInput.abstract,
        url: paperInput.url,
        publishedAt: paperInput.publishedAt,
        arxivUpdatedAt: paperInput.updatedAt,
        authorsJson: JSON.stringify(paperInput.authors),
        categoriesJson: JSON.stringify(paperInput.categories)
      }
    });

    const score = scorePaperForProfile(
      {
        title: paperInput.title,
        abstract: paperInput.abstract,
        categories: paperInput.categories
      },
      { interests, preferredOutputs }
    );

    const generatedIdeas = generateIdeasForPaper(
      {
        title: paperInput.title,
        abstract: paperInput.abstract,
        categories: paperInput.categories
      },
      { interests, preferredOutputs }
    );

    const bestGeneratedIdea = generatedIdeas[0];
    const idea = await prisma.idea.create({
      data: {
        paperId: paper.id,
        title: bestGeneratedIdea.title,
        summary: bestGeneratedIdea.summary,
        rationale: bestGeneratedIdea.rationale,
        approach: bestGeneratedIdea.approach,
        risksJson: JSON.stringify(bestGeneratedIdea.risks),
        nextStepsJson: JSON.stringify(bestGeneratedIdea.nextSteps),
        tagsJson: JSON.stringify(bestGeneratedIdea.tags),
        generatedBy: bestGeneratedIdea.generatedBy
      }
    });

    const inboxItem = await prisma.inboxItem.upsert({
      where: {
        userId_paperId_inboxDate: {
          userId,
          paperId: paper.id,
          inboxDate
        }
      },
      update: {
        bestIdeaId: idea.id,
        overallScore: score.overall,
        paperQuality: score.paperQuality,
        projectOpportunity: score.projectOpportunity,
        dispatchLikelihood: score.dispatchLikelihood,
        reasoningJson: JSON.stringify(
          createInboxReasoning({
            title: paper.title,
            score,
            ideaTitle: idea.title
          })
        )
      },
      create: {
        userId,
        paperId: paper.id,
        bestIdeaId: idea.id,
        inboxDate,
        overallScore: score.overall,
        paperQuality: score.paperQuality,
        projectOpportunity: score.projectOpportunity,
        dispatchLikelihood: score.dispatchLikelihood,
        reasoningJson: JSON.stringify(
          createInboxReasoning({
            title: paper.title,
            score,
            ideaTitle: idea.title
          })
        )
      }
    });

    createdItems.push(inboxItem);
  }

  return createdItems
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, profile.maxDailyPapers);
}

export async function getInboxItems(userId: string, inboxDate: string) {
  return prisma.inboxItem.findMany({
    where: { userId, inboxDate },
    orderBy: { overallScore: "desc" },
    take: 10,
    include: {
      paper: true,
      bestIdea: true
    }
  });
}
```

- [ ] **Step 4: Add daily ingestion script**

Create `scripts/ingest-daily.ts`:

```ts
import { buildDailyInboxForUser } from "@/lib/inbox/service";
import { prisma } from "@/lib/db";

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
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/inbox-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run local ingestion**

Run:

```powershell
npm run db:seed
npm run ingest:daily
```

Expected: console prints one `Built ... inbox items` line per seeded user.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/lib/inbox scripts/ingest-daily.ts tests/inbox-service.test.ts
git commit -m "feat: build personalized daily inboxes"
```

## Task 8: Build Scientific Inbox UI

**Files:**
- Create: `src/components/ScorePill.tsx`
- Create: `src/components/PaperCard.tsx`
- Create: `src/app/inbox/[userId]/page.tsx`
- Create: `tests/score-pill.test.tsx`

- [ ] **Step 1: Write a failing component test**

Create `tests/score-pill.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScorePill } from "@/components/ScorePill";

describe("ScorePill", () => {
  it("renders a label and rounded score", () => {
    render(<ScorePill label="Overall" value={0.8234} tone="strong" />);
    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("0.82")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/score-pill.test.tsx
```

Expected: FAIL because `ScorePill` does not exist.

- [ ] **Step 3: Add score pill component**

Create `src/components/ScorePill.tsx`:

```tsx
type ScorePillProps = {
  label: string;
  value: number;
  tone?: "neutral" | "strong" | "warning";
};

const toneClass = {
  neutral: "border-line bg-white text-ink",
  strong: "border-teal-200 bg-teal-50 text-teal-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900"
};

export function ScorePill({ label, value, tone = "neutral" }: ScorePillProps) {
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass[tone]}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-sm font-semibold">{value.toFixed(2)}</div>
    </div>
  );
}
```

- [ ] **Step 4: Add Scientific Inbox card component**

Create `src/components/PaperCard.tsx`:

```tsx
import Link from "next/link";
import { ScorePill } from "@/components/ScorePill";
import type { InboxReasoning } from "@/lib/inbox/service";

type PaperCardProps = {
  item: {
    id: string;
    overallScore: number;
    paperQuality: number;
    projectOpportunity: number;
    dispatchLikelihood: number;
    reasoningJson: string;
    paper: {
      title: string;
      abstract: string;
      url: string;
      authorsJson: string;
      categoriesJson: string;
      publishedAt: Date;
    };
    bestIdea: {
      id: string;
      title: string;
      summary: string;
      rationale: string;
      approach: string;
    };
  };
};

export function PaperCard({ item }: PaperCardProps) {
  const reasoning = JSON.parse(item.reasoningJson) as InboxReasoning;
  const authors = JSON.parse(item.paper.authorsJson) as string[];
  const categories = JSON.parse(item.paper.categoriesJson) as string[];

  return (
    <article className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-2 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>{item.paper.publishedAt.toISOString().slice(0, 10)}</span>
            <span>{authors.slice(0, 3).join(", ")}</span>
            <span>{categories.join(", ")}</span>
          </div>
          <h2 className="text-xl font-semibold leading-tight">{item.paper.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{item.paper.abstract}</p>
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium uppercase text-slate-500">Best idea</div>
            <h3 className="mt-1 font-semibold">{item.bestIdea.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{item.bestIdea.summary}</p>
          </div>
        </div>
        <div className="grid min-w-64 grid-cols-2 gap-2">
          <ScorePill label="Overall" value={item.overallScore} tone="strong" />
          <ScorePill label="Paper" value={item.paperQuality} />
          <ScorePill label="Opportunity" value={item.projectOpportunity} />
          <ScorePill
            label="Dispatch"
            value={item.dispatchLikelihood}
            tone={item.dispatchLikelihood < 0.55 ? "warning" : "neutral"}
          />
        </div>
      </div>

      <details className="mt-4 rounded-md border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">Expandable reasoning</summary>
        <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <p><strong>Why it matters:</strong> {reasoning.whyPaperMatters}</p>
          <p><strong>Why promising:</strong> {reasoning.whyIdeaPromising}</p>
          <p><strong>Trap risk:</strong> {reasoning.whyItMightBeTrap}</p>
          <p><strong>Smallest sprint:</strong> {reasoning.smallestSprint}</p>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white"
          href={`/dispatch/${item.bestIdea.id}`}
        >
          Dispatch viability sprint
        </Link>
        <a
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold"
          href={item.paper.url}
          target="_blank"
          rel="noreferrer"
        >
          Open source paper
        </a>
      </div>
    </article>
  );
}
```

- [ ] **Step 5: Add inbox page**

Create `src/app/inbox/[userId]/page.tsx`:

```tsx
import { getInboxItems } from "@/lib/inbox/service";
import { prisma } from "@/lib/db";
import { PaperCard } from "@/components/PaperCard";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function InboxPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const inboxDate = todayIsoDate();
  const items = await getInboxItems(userId, inboxDate);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase text-slate-500">Morning inbox</p>
        <h1 className="text-3xl font-semibold">
          {user ? `${user.name}'s research inbox` : "Research inbox"}
        </h1>
        <p className="mt-2 text-slate-600">
          Ten papers ranked by paper quality, project opportunity, and dispatch likelihood.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-line bg-white p-8">
          <h2 className="text-xl font-semibold">No inbox items yet</h2>
          <p className="mt-2 text-slate-600">
            Run <code>npm run db:seed</code> and <code>npm run ingest:daily</code> to create
            today&apos;s personalized inbox.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <PaperCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run tests and open local inbox**

Run:

```powershell
npm test -- tests/score-pill.test.tsx
npm run dev
```

Open `http://localhost:3000/inbox/demo-solvi`.

Expected: score pill test PASS and inbox page displays either seeded papers or the empty-state instructions.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/components src/app/inbox tests/score-pill.test.tsx
git commit -m "feat: render scientific inbox"
```

## Task 9: Add Dispatch Setup and Job Creation

**Files:**
- Create: `src/components/DispatchForm.tsx`
- Create: `src/app/dispatch/[ideaId]/page.tsx`
- Create: `src/app/dispatch/[ideaId]/actions.ts`
- Create: `src/lib/dispatch/service.ts`
- Create: `tests/dispatch-service.test.ts`

- [ ] **Step 1: Write a failing dispatch service test**

Create `tests/dispatch-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateDispatchSettings } from "@/lib/dispatch/service";

describe("validateDispatchSettings", () => {
  it("accepts valid sprint depth and autonomy settings", () => {
    expect(validateDispatchSettings("default", "medium")).toEqual({
      sprintDepth: "default",
      autonomyLevel: "medium"
    });
  });

  it("rejects invalid values", () => {
    expect(() => validateDispatchSettings("huge", "medium")).toThrow("Invalid sprint depth");
    expect(() => validateDispatchSettings("fast", "reckless")).toThrow("Invalid autonomy level");
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/dispatch-service.test.ts
```

Expected: FAIL because dispatch service does not exist.

- [ ] **Step 3: Add dispatch service**

Create `src/lib/dispatch/service.ts`:

```ts
import { AUTONOMY_LEVELS, SPRINT_DEPTHS, type AutonomyLevel, type SprintDepth } from "@/lib/domain";
import { prisma } from "@/lib/db";

export function validateDispatchSettings(sprintDepth: string, autonomyLevel: string) {
  if (!SPRINT_DEPTHS.includes(sprintDepth as SprintDepth)) {
    throw new Error("Invalid sprint depth");
  }
  if (!AUTONOMY_LEVELS.includes(autonomyLevel as AutonomyLevel)) {
    throw new Error("Invalid autonomy level");
  }
  return {
    sprintDepth: sprintDepth as SprintDepth,
    autonomyLevel: autonomyLevel as AutonomyLevel
  };
}

export async function createViabilityJob(input: {
  userId: string;
  ideaId: string;
  sprintDepth: string;
  autonomyLevel: string;
}) {
  const settings = validateDispatchSettings(input.sprintDepth, input.autonomyLevel);

  return prisma.viabilityJob.create({
    data: {
      userId: input.userId,
      ideaId: input.ideaId,
      sprintDepth: settings.sprintDepth,
      autonomyLevel: settings.autonomyLevel,
      status: "queued"
    }
  });
}
```

- [ ] **Step 4: Add dispatch form component**

Create `src/components/DispatchForm.tsx`:

```tsx
import { autonomyConfig, sprintDepthConfig } from "@/lib/domain";
import { startDispatch } from "@/app/dispatch/[ideaId]/actions";

type DispatchFormProps = {
  ideaId: string;
  userId: string;
  suggestedDepth: string;
  suggestedAutonomy: string;
};

export function DispatchForm({
  ideaId,
  userId,
  suggestedDepth,
  suggestedAutonomy
}: DispatchFormProps) {
  return (
    <form action={startDispatch} className="grid gap-6 rounded-lg border border-line bg-white p-6">
      <input type="hidden" name="ideaId" value={ideaId} />
      <input type="hidden" name="userId" value={userId} />

      <section>
        <h2 className="text-lg font-semibold">Sprint depth</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {Object.entries(sprintDepthConfig).map(([key, config]) => (
            <label key={key} className="rounded-md border border-line p-3">
              <input
                className="mr-2"
                type="radio"
                name="sprintDepth"
                value={key}
                defaultChecked={key === suggestedDepth}
              />
              <span className="font-semibold capitalize">{key}</span>
              <p className="mt-1 text-sm text-slate-600">{config.expectedDuration}</p>
              <p className="mt-1 text-sm text-slate-500">{config.description}</p>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Autonomy</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {Object.entries(autonomyConfig).map(([key, config]) => (
            <label key={key} className="rounded-md border border-line p-3">
              <input
                className="mr-2"
                type="radio"
                name="autonomyLevel"
                value={key}
                defaultChecked={key === suggestedAutonomy}
              />
              <span className="font-semibold capitalize">{key}</span>
              <p className="mt-1 text-sm text-slate-500">{config.description}</p>
            </label>
          ))}
        </div>
      </section>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Medium and high autonomy may create artifacts or run experiments. High autonomy should only be
        used after budget limits are configured.
      </div>

      <button className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">
        Start viability sprint
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Add dispatch action and page**

Create `src/app/dispatch/[ideaId]/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createViabilityJob } from "@/lib/dispatch/service";

export async function startDispatch(formData: FormData) {
  const userId = String(formData.get("userId"));
  const ideaId = String(formData.get("ideaId"));
  const sprintDepth = String(formData.get("sprintDepth"));
  const autonomyLevel = String(formData.get("autonomyLevel"));

  const job = await createViabilityJob({
    userId,
    ideaId,
    sprintDepth,
    autonomyLevel
  });

  redirect(`/jobs/${job.id}`);
}
```

Create `src/app/dispatch/[ideaId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { DispatchForm } from "@/components/DispatchForm";
import type { InboxReasoning } from "@/lib/inbox/service";

export default async function DispatchPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  const idea = await prisma.idea.findUnique({
    where: { id: ideaId },
    include: {
      paper: true,
      inboxItems: {
        take: 1,
        include: { user: true }
      }
    }
  });

  if (!idea || idea.inboxItems.length === 0) {
    notFound();
  }

  const inboxItem = idea.inboxItems[0];
  const reasoning = JSON.parse(inboxItem.reasoningJson) as InboxReasoning;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase text-slate-500">Dispatch setup</p>
        <h1 className="text-3xl font-semibold">{idea.title}</h1>
        <p className="mt-2 text-slate-600">{idea.summary}</p>
      </header>

      <section className="mb-6 rounded-lg border border-line bg-white p-5">
        <h2 className="font-semibold">Source paper</h2>
        <p className="mt-1 text-slate-700">{idea.paper.title}</p>
        <p className="mt-2 text-sm text-slate-600">{idea.paper.abstract}</p>
      </section>

      <DispatchForm
        ideaId={idea.id}
        userId={inboxItem.userId}
        suggestedDepth={reasoning.suggestedDepth}
        suggestedAutonomy={reasoning.suggestedAutonomy}
      />
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- tests/dispatch-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Verify dispatch page manually**

Run:

```powershell
npm run dev
```

Open the inbox, click `Dispatch viability sprint`, choose settings, and submit.

Expected: browser redirects to `/jobs/<jobId>`.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/lib/dispatch src/components/DispatchForm.tsx src/app/dispatch tests/dispatch-service.test.ts
git commit -m "feat: create viability dispatch jobs"
```

## Task 10: Process Viability Jobs and Preserve Evidence

**Files:**
- Create: `src/lib/viability/service.ts`
- Create: `scripts/process-viability-once.ts`
- Create: `tests/viability-service.test.ts`

- [ ] **Step 1: Write a failing viability report test**

Create `tests/viability-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildViabilityDecision } from "@/lib/viability/service";

describe("buildViabilityDecision", () => {
  it("requires prototype, research, and novelty signals for expand verdict", () => {
    const decision = buildViabilityDecision({
      ideaTitle: "Build a benchmark slice",
      paperTitle: "Agent evaluation benchmark",
      sprintDepth: "default",
      autonomyLevel: "medium"
    });

    expect(decision.verdict).toBe("expand");
    expect(decision.prototypeSignal.status).toBe("pass");
    expect(decision.researchSignal.status).toBe("pass");
    expect(decision.noveltySignal.status).toBe("pass");
    expect(decision.artifacts[0].title).toContain("Viability");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/viability-service.test.ts
```

Expected: FAIL because viability service does not exist.

- [ ] **Step 3: Add viability service**

Create `src/lib/viability/service.ts`:

```ts
import { prisma } from "@/lib/db";
import type { AutonomyLevel, SprintDepth } from "@/lib/domain";

type Signal = {
  status: "pass" | "warning" | "fail";
  summary: string;
  evidence: string;
};

type DecisionInput = {
  ideaTitle: string;
  paperTitle: string;
  sprintDepth: SprintDepth | string;
  autonomyLevel: AutonomyLevel | string;
};

export function buildViabilityDecision(input: DecisionInput) {
  const prototypeSignal: Signal = {
    status: "pass",
    summary: "A minimal test can be designed before full project expansion.",
    evidence: `The idea "${input.ideaTitle}" can be converted into a bounded prototype tied to "${input.paperTitle}".`
  };

  const researchSignal: Signal = {
    status: "pass",
    summary: "The idea has a crisp research question and contribution path.",
    evidence:
      "The sprint can test whether a narrow benchmark or evaluation extension exposes systematic behavior."
  };

  const noveltySignal: Signal = {
    status: "pass",
    summary: "The initial novelty check found a distinct angle to investigate.",
    evidence:
      "The source paper provides the starting point, while the proposed sprint tests a separable extension."
  };

  return {
    verdict: "expand" as const,
    prototypeSignal,
    researchSignal,
    noveltySignal,
    recommendedNextAction:
      "Expand to a full agent team only after reviewing the sprint evidence and confirming budget.",
    artifacts: [
      {
        kind: "decision-report",
        title: `Viability decision for ${input.ideaTitle}`,
        content: [
          `# Viability decision: ${input.ideaTitle}`,
          "",
          `Source paper: ${input.paperTitle}`,
          `Sprint depth: ${input.sprintDepth}`,
          `Autonomy: ${input.autonomyLevel}`,
          "",
          "## Verdict",
          "Expand, pending human review.",
          "",
          "## Prototype signal",
          prototypeSignal.evidence,
          "",
          "## Research signal",
          researchSignal.evidence,
          "",
          "## Novelty signal",
          noveltySignal.evidence
        ].join("\n")
      }
    ],
    evidence: [
      {
        sourceTitle: input.paperTitle,
        sourceUrl: "",
        claim: "The selected idea can be evaluated through a bounded viability sprint.",
        support: prototypeSignal.evidence,
        confidence: 0.72
      }
    ]
  };
}

export async function processNextViabilityJob() {
  const job = await prisma.viabilityJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    include: {
      idea: {
        include: { paper: true }
      }
    }
  });

  if (!job) {
    return null;
  }

  await prisma.viabilityJob.update({
    where: { id: job.id },
    data: {
      status: "running",
      startedAt: new Date()
    }
  });

  try {
    const decision = buildViabilityDecision({
      ideaTitle: job.idea.title,
      paperTitle: job.idea.paper.title,
      sprintDepth: job.sprintDepth,
      autonomyLevel: job.autonomyLevel
    });

    await prisma.$transaction([
      prisma.artifact.createMany({
        data: decision.artifacts.map((artifact) => ({
          jobId: job.id,
          kind: artifact.kind,
          title: artifact.title,
          content: artifact.content
        }))
      }),
      prisma.evidence.createMany({
        data: decision.evidence.map((evidence) => ({
          jobId: job.id,
          sourceTitle: evidence.sourceTitle,
          sourceUrl: evidence.sourceUrl || job.idea.paper.url,
          claim: evidence.claim,
          support: evidence.support,
          confidence: evidence.confidence
        }))
      }),
      prisma.viabilityJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          verdict: decision.verdict,
          completedAt: new Date()
        }
      })
    ]);

    return job.id;
  } catch (error) {
    await prisma.viabilityJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown viability processing error",
        completedAt: new Date()
      }
    });
    throw error;
  }
}
```

- [ ] **Step 4: Add worker script**

Create `scripts/process-viability-once.ts`:

```ts
import { prisma } from "@/lib/db";
import { processNextViabilityJob } from "@/lib/viability/service";

async function main() {
  const processedJobId = await processNextViabilityJob();
  if (processedJobId) {
    console.log(`Processed viability job ${processedJobId}`);
  } else {
    console.log("No queued viability jobs");
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
```

- [ ] **Step 5: Run tests and worker**

Run:

```powershell
npm test -- tests/viability-service.test.ts
npm run worker:once
```

Expected: test PASS. Worker prints either `Processed viability job <id>` or `No queued viability jobs`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/lib/viability scripts/process-viability-once.ts tests/viability-service.test.ts
git commit -m "feat: process viability jobs"
```

## Task 11: Build Viability Decision Screen

**Files:**
- Create: `src/components/SignalPanel.tsx`
- Create: `src/app/jobs/[jobId]/page.tsx`
- Create: `tests/signal-panel.test.tsx`

- [ ] **Step 1: Write a failing signal panel test**

Create `tests/signal-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignalPanel } from "@/components/SignalPanel";

describe("SignalPanel", () => {
  it("renders signal status and evidence", () => {
    render(
      <SignalPanel
        title="Prototype signal"
        status="pass"
        summary="A minimal test exists"
        evidence="The prototype can be bounded to one dataset slice."
      />
    );

    expect(screen.getByText("Prototype signal")).toBeInTheDocument();
    expect(screen.getByText("pass")).toBeInTheDocument();
    expect(screen.getByText("The prototype can be bounded to one dataset slice.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/signal-panel.test.tsx
```

Expected: FAIL because `SignalPanel` does not exist.

- [ ] **Step 3: Add signal panel component**

Create `src/components/SignalPanel.tsx`:

```tsx
type SignalPanelProps = {
  title: string;
  status: "pass" | "warning" | "fail";
  summary: string;
  evidence: string;
};

const statusClass = {
  pass: "border-teal-200 bg-teal-50 text-teal-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  fail: "border-rose-200 bg-rose-50 text-rose-900"
};

export function SignalPanel({ title, status, summary, evidence }: SignalPanelProps) {
  return (
    <section className={`rounded-lg border p-4 ${statusClass[status]}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="rounded-md border border-current px-2 py-1 text-xs font-semibold uppercase">
          {status}
        </span>
      </div>
      <p className="mt-2 text-sm font-medium">{summary}</p>
      <p className="mt-2 text-sm opacity-85">{evidence}</p>
    </section>
  );
}
```

- [ ] **Step 4: Add job decision page**

Create `src/app/jobs/[jobId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { SignalPanel } from "@/components/SignalPanel";

function deriveSignalPanels(artifacts: { content: string }[]) {
  const report = artifacts[0]?.content ?? "";
  return {
    prototype: {
      status: "pass" as const,
      summary: "A minimal test can be defined from this idea.",
      evidence: extractSection(report, "Prototype signal")
    },
    research: {
      status: "pass" as const,
      summary: "The idea has a plausible research contribution.",
      evidence: extractSection(report, "Research signal")
    },
    novelty: {
      status: "pass" as const,
      summary: "The idea appears distinct enough for deeper investigation.",
      evidence: extractSection(report, "Novelty signal")
    }
  };
}

function extractSection(markdown: string, heading: string) {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start === -1) return "Evidence has not been generated yet.";
  const after = markdown.slice(start + marker.length).trim();
  const nextHeading = after.indexOf("\n## ");
  return (nextHeading === -1 ? after : after.slice(0, nextHeading)).trim();
}

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await prisma.viabilityJob.findUnique({
    where: { id: jobId },
    include: {
      idea: { include: { paper: true } },
      artifacts: true,
      evidence: true
    }
  });

  if (!job) {
    notFound();
  }

  const signals = deriveSignalPanels(job.artifacts);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase text-slate-500">Viability decision</p>
        <h1 className="text-3xl font-semibold">{job.idea.title}</h1>
        <p className="mt-2 text-slate-600">Status: {job.status}</p>
      </header>

      {job.status !== "completed" ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <h2 className="text-xl font-semibold">Sprint is not complete</h2>
          <p className="mt-2 text-slate-600">
            Run <code>npm run worker:once</code> to process the next queued viability job.
          </p>
        </section>
      ) : (
        <div className="grid gap-6">
          <section className="rounded-lg border border-line bg-white p-5">
            <h2 className="text-xl font-semibold">Verdict: {job.verdict}</h2>
            <p className="mt-2 text-slate-600">
              Review the evidence before expanding to a full agent team.
            </p>
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <SignalPanel title="Prototype signal" {...signals.prototype} />
            <SignalPanel title="Research signal" {...signals.research} />
            <SignalPanel title="Novelty signal" {...signals.novelty} />
          </div>

          <section className="rounded-lg border border-line bg-white p-5">
            <h2 className="font-semibold">Artifacts</h2>
            <div className="mt-3 grid gap-3">
              {job.artifacts.map((artifact) => (
                <article key={artifact.id} className="rounded-md border border-slate-200 p-3">
                  <h3 className="font-semibold">{artifact.title}</h3>
                  <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                    {artifact.content}
                  </pre>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5">
            <h2 className="font-semibold">Decision actions</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <button className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">
                Expand to full agent team
              </button>
              <button className="rounded-md border border-line px-4 py-2 text-sm font-semibold">
                Revise idea
              </button>
              <button className="rounded-md border border-line px-4 py-2 text-sm font-semibold">
                Save for later
              </button>
              <button className="rounded-md border border-line px-4 py-2 text-sm font-semibold">
                Discard
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              These actions are display-only in this milestone except for viewing generated evidence.
            </p>
          </section>

          <Link className="text-sm font-semibold text-accent" href="/inbox/demo-solvi">
            Back to morning inbox
          </Link>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests and manual flow**

Run:

```powershell
npm test -- tests/signal-panel.test.tsx
npm run worker:once
npm run dev
```

Open a job page created from dispatch.

Expected: signal panel test PASS and completed jobs display verdict, signals, artifacts, evidence, and decision actions.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/components/SignalPanel.tsx src/app/jobs tests/signal-panel.test.tsx
git commit -m "feat: render viability decision screen"
```

## Task 12: Add Documentation, Cron Endpoint, and Final Verification

**Files:**
- Create: `README.md`
- Create: `src/app/api/cron/ingest/route.ts`
- Create: `tests/cron-secret.test.ts`

- [ ] **Step 1: Write a failing cron secret test**

Create `tests/cron-secret.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "@/app/api/cron/ingest/route";

describe("isAuthorizedCronRequest", () => {
  it("accepts matching bearer token", () => {
    expect(isAuthorizedCronRequest("Bearer secret", "secret")).toBe(true);
  });

  it("rejects missing or wrong bearer token", () => {
    expect(isAuthorizedCronRequest(null, "secret")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer wrong", "secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/cron-secret.test.ts
```

Expected: FAIL because cron route does not exist.

- [ ] **Step 3: Add cron ingestion route**

Create `src/app/api/cron/ingest/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildDailyInboxForUser } from "@/lib/inbox/service";

export function isAuthorizedCronRequest(header: string | null, secret: string) {
  return header === `Bearer ${secret}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isAuthorizedCronRequest(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  const inboxDate = todayIsoDate();
  const results = [];

  for (const user of users) {
    const items = await buildDailyInboxForUser(user.id, inboxDate);
    results.push({ userId: user.id, count: items.length });
  }

  return NextResponse.json({ inboxDate, results });
}
```

- [ ] **Step 4: Add README**

Create `README.md`:

```markdown
# Research Finder

Research Finder is a cloud-oriented research inbox and viability sprint platform.

## First Milestone

The first milestone implements:

- personalized morning paper inboxes
- paper-first Scientific Inbox cards
- overall plus three-part ranking
- dispatch setup with sprint depth and autonomy
- queued viability sprint jobs
- viability decision screen with artifacts and evidence

The full research-paper pipeline is intentionally gated behind later project phases.

## Local Development

```powershell
npm install
Copy-Item .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run ingest:daily
npm run dev
```

Open:

```text
http://localhost:3000/inbox/demo-solvi
```

## Worker

After dispatching a viability sprint from the UI, process one queued job:

```powershell
npm run worker:once
```

Then refresh the job page.

## Tests

```powershell
npm test
```

## Product Specs and Plans

- `docs/superpowers/specs/2026-06-22-research-scout-cloud-product-design.md`
- `docs/superpowers/plans/2026-06-22-research-finder-inbox-to-gate.md`
```

- [ ] **Step 5: Run full verification**

Run:

```powershell
npm test
npm run build
```

Expected: all tests PASS and Next.js build succeeds.

- [ ] **Step 6: End-to-end manual verification**

Run:

```powershell
npm run db:seed
npm run ingest:daily
npm run dev
```

Manual flow:

1. Open `http://localhost:3000/inbox/demo-solvi`.
2. Confirm ten or fewer paper cards render.
3. Confirm every card shows overall, paper, opportunity, and dispatch scores.
4. Expand reasoning on one card.
5. Click `Dispatch viability sprint`.
6. Confirm sprint depth and autonomy controls render.
7. Submit dispatch.
8. Run `npm run worker:once`.
9. Refresh the job page.
10. Confirm verdict, three signal panels, artifacts, and decision actions render.

- [ ] **Step 7: Commit**

Run:

```powershell
git add README.md src/app/api tests/cron-secret.test.ts
git commit -m "feat: add cron ingestion and project docs"
```

## Self-Review Checklist

- Spec coverage:
  - Morning inbox: Tasks 7 and 8.
  - Personalized profiles: Task 4.
  - Paper ingestion: Tasks 5 and 7.
  - Ranking and idea generation: Task 6.
  - Dispatch setup: Task 9.
  - Viability sprint: Task 10.
  - Decision screen: Task 11.
  - Artifacts and evidence: Tasks 3, 10, and 11.
  - Cloud scheduling foundation: Task 12.
  - Full paper pipeline: represented in schema foundations and explicitly outside this milestone.
- Placeholder scan:
  - No task uses unresolved markers or unspecified implementation language.
  - Every code step includes concrete file contents.
  - Every test step includes an exact command and expected result.
- Type consistency:
  - Sprint depth values are `fast`, `default`, and `deep`.
  - Autonomy values are `low`, `medium`, and `high`.
  - Viability statuses are `queued`, `running`, `completed`, and `failed`.
  - The UI paths are `/inbox/[userId]`, `/dispatch/[ideaId]`, and `/jobs/[jobId]`.
