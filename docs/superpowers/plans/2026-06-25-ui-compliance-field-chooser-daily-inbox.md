# UI Compliance, Field Chooser, and Per-Day Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the whole app obey the dark command-center design system, add a real "choose your field" flow (onboarding picker + 4 presets + reactive editor), and turn the inbox into a navigable per-day view with no cross-day paper overlap.

**Architecture:** One Tailwind token system (`rf.*` + semantic `rf.success/warning/danger`) with a single `status-styles` map; every page wrapped in the existing `AppShell` via a thin `PageShell` server component; field presets stay the single source of truth in `field-presets.ts`; the inbox page reads a `?date=` param and queries one day; candidate fetching filters out previously-seen arXiv IDs.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma/Postgres, Tailwind CSS, Vitest + Testing Library.

**Source spec:** `docs/superpowers/specs/2026-06-25-ui-compliance-field-chooser-daily-inbox-design.md`

---

## Conventions used in this plan

- Run a single test file: `npm test -- tests/<file>`
- Run Postgres-backed tests (they create a throwaway schema per test):
  ```powershell
  $env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
  npm test -- tests/<file> --no-file-parallelism --testTimeout 60000
  ```
- DB-backed tests mock the Prisma singleton with a getter and assign the per-test client (existing pattern, see `tests/generated-inbox-persistence.test.ts`):
  ```ts
  const mocked = vi.hoisted(() => ({ prisma: null as import("@prisma/client").PrismaClient | null }));
  vi.mock("@/lib/db", () => ({
    get prisma() {
      if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
      return mocked.prisma;
    }
  }));
  ```
- Full verification: `npm run lint`, `npx tsc --noEmit --pretty false`, `npm run build`.

## File Map

- Modify `tailwind.config.ts` — drop legacy tokens, add `rf.success/warning/danger`.
- Create `src/lib/ui/status-styles.ts` — single source of status→class mapping.
- Modify `src/components/ScorePill.tsx`, `src/components/SignalPanel.tsx`, `src/components/WorkerStatusPanel.tsx` — consume `status-styles`.
- Create `src/lib/workers/status.ts` — `resolveWorkerStatusForUser`.
- Create `src/components/PageShell.tsx` — server wrapper around `AppShell`.
- Modify `src/components/PaperCard.tsx`, `src/components/DispatchForm.tsx`, `src/components/WorkerSetupContent.tsx` — rf tokens.
- Modify `src/app/dispatch/[ideaId]/page.tsx`, `src/app/jobs/[jobId]/page.tsx`, `src/app/profiles/[userId]/page.tsx`, `src/app/workers/page.tsx`, `src/app/inbox/[userId]/page.tsx` — rf tokens + `PageShell`.
- Modify `src/lib/profiles/field-presets.ts` — add `biology`, `economics`.
- Modify `src/lib/profiles/service.ts` — persist `interests` correctly; add `interests` to `ProfileUpdateData`.
- Modify `src/app/profiles/[userId]/actions.ts` — pass `interests` through.
- Modify `src/components/ProfileForm.tsx` — client component, reactive preset.
- Create `src/app/onboarding/page.tsx`, `src/app/onboarding/actions.ts`, `src/components/OnboardingPicker.tsx`.
- Modify `src/app/page.tsx` — route profile-less users to onboarding.
- Modify `src/lib/jobs/inbox-generation.ts` — add `listInboxDatesForUser`.
- Create `src/components/InboxDateNav.tsx` — client date navigator.
- Modify `src/lib/sources/arxiv-candidates.ts` — cross-day dedup.
- Tests: update `tests/score-pill.test.tsx`, `tests/signal-panel.test.tsx`, `tests/profile-presets.test.ts`, `tests/profile-form.test.tsx`, `tests/app-page-auth.test.ts`; create `tests/status-styles.test.ts`, `tests/worker-status.test.ts`, `tests/profile-service.test.ts` (extend), `tests/onboarding.test.ts`, `tests/inbox-dates.test.ts`, `tests/inbox-date-nav.test.tsx`, `tests/arxiv-candidates-dedup.test.ts`, `tests/no-legacy-colors.test.ts`.

---

## Task 1: Design tokens + status-styles module

**Files:**
- Modify: `tailwind.config.ts`
- Create: `src/lib/ui/status-styles.ts`
- Create: `tests/status-styles.test.ts`

- [ ] **Step 1: Add semantic status tokens to Tailwind (keep legacy tokens for now)**

Edit `tailwind.config.ts` so the `rf` color object gains three semantic colors. Leave `ink`/`paper`/`line`/`accent` in place for now (they are removed in Task 16 once nothing uses them). New `rf` block:

```ts
        rf: {
          black: "#050507",
          panel: "#09080d",
          surface: "#0d0b12",
          border: "#2f293d",
          violet: "#651fff",
          violetSoft: "#7c4dff",
          white: "#f8f7ff",
          muted: "#aaa3bc",
          success: "#34d399",
          warning: "#fbbf24",
          danger: "#fb7185"
        },
```

- [ ] **Step 2: Write the status-styles test**

Create `tests/status-styles.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  noveltyLabelStyles,
  scoreToneStyles,
  signalStatusStyles,
  workerStatusStyles
} from "@/lib/ui/status-styles";

describe("status styles", () => {
  it("maps worker statuses to rf token classes only", () => {
    expect(workerStatusStyles.online).toContain("rf-success");
    expect(workerStatusStyles.offline).toContain("rf-danger");
    expect(workerStatusStyles.needs_auth).toContain("rf-warning");
    expect(workerStatusStyles.unknown).toContain("rf-muted");
  });

  it("maps signal statuses", () => {
    expect(signalStatusStyles.pass).toContain("rf-success");
    expect(signalStatusStyles.warning).toContain("rf-warning");
    expect(signalStatusStyles.fail).toContain("rf-danger");
  });

  it("maps score tones with violet as the strong accent", () => {
    expect(scoreToneStyles.strong).toContain("rf-violet");
    expect(scoreToneStyles.neutral).toContain("rf-border");
    expect(scoreToneStyles.warning).toContain("rf-warning");
  });

  it("maps every novelty label", () => {
    expect(noveltyLabelStyles.likely_novel).toContain("rf-success");
    expect(noveltyLabelStyles.crowded).toContain("rf-warning");
    expect(noveltyLabelStyles.near_duplicate).toContain("rf-danger");
    expect(noveltyLabelStyles.unclear).toContain("rf-muted");
    expect(noveltyLabelStyles.not_checked).toContain("rf-muted");
  });

  it("never references off-brand palette colors", () => {
    const all = [
      ...Object.values(workerStatusStyles),
      ...Object.values(signalStatusStyles),
      ...Object.values(scoreToneStyles),
      ...Object.values(noveltyLabelStyles)
    ].join(" ");
    expect(all).not.toMatch(/(slate|teal|amber|emerald|rose|sky|gray)-\d/);
    expect(all).not.toMatch(/\b(?:bg|text|border)-white\b/);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npm test -- tests/status-styles.test.ts`
Expected: FAIL — module `@/lib/ui/status-styles` does not exist.

- [ ] **Step 4: Implement the status-styles module**

Create `src/lib/ui/status-styles.ts`:

```ts
export type WorkerStatusKey = "online" | "offline" | "needs_auth" | "unknown";
export type SignalStatusKey = "pass" | "warning" | "fail";
export type ScoreToneKey = "neutral" | "strong" | "warning";
export type NoveltyLabelKey =
  | "likely_novel"
  | "unclear"
  | "crowded"
  | "near_duplicate"
  | "not_checked";

export const workerStatusStyles: Record<WorkerStatusKey, string> = {
  online: "border-rf-success/40 bg-rf-success/10 text-rf-success",
  offline: "border-rf-danger/40 bg-rf-danger/10 text-rf-danger",
  needs_auth: "border-rf-warning/40 bg-rf-warning/10 text-rf-warning",
  unknown: "border-rf-border bg-rf-surface text-rf-muted"
};

export const signalStatusStyles: Record<SignalStatusKey, string> = {
  pass: "border-rf-success/40 bg-rf-success/10 text-rf-success",
  warning: "border-rf-warning/40 bg-rf-warning/10 text-rf-warning",
  fail: "border-rf-danger/40 bg-rf-danger/10 text-rf-danger"
};

export const scoreToneStyles: Record<ScoreToneKey, string> = {
  neutral: "border-rf-border bg-rf-surface text-rf-white",
  strong: "border-rf-violetSoft/50 bg-rf-violet/15 text-rf-white",
  warning: "border-rf-warning/40 bg-rf-warning/10 text-rf-warning"
};

export const noveltyLabelStyles: Record<NoveltyLabelKey, string> = {
  likely_novel: "border-rf-success/40 bg-rf-success/10 text-rf-success",
  unclear: "border-rf-border bg-rf-surface text-rf-muted",
  crowded: "border-rf-warning/40 bg-rf-warning/10 text-rf-warning",
  near_duplicate: "border-rf-danger/40 bg-rf-danger/10 text-rf-danger",
  not_checked: "border-rf-border bg-rf-surface text-rf-muted"
};
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm test -- tests/status-styles.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tailwind.config.ts src/lib/ui/status-styles.ts tests/status-styles.test.ts
git commit -m "feat: add semantic status tokens and status-styles map"
```

---

## Task 2: Migrate status components to rf tokens

**Files:**
- Modify: `src/components/ScorePill.tsx`, `src/components/SignalPanel.tsx`, `src/components/WorkerStatusPanel.tsx`
- Modify: `tests/score-pill.test.tsx`, `tests/signal-panel.test.tsx`

- [ ] **Step 1: Update ScorePill test to expect rf tokens**

Replace the three class assertions in `tests/score-pill.test.tsx`:

- strong tone (first test):
  ```ts
  expect(pill).toHaveClass(
    "border-rf-violetSoft/50",
    "bg-rf-violet/15",
    "text-rf-white",
    "min-w-[7rem]",
    "min-h-16"
  );
  ```
- neutral tone (second test):
  ```ts
  expect(screen.getByTestId("score-pill")).toHaveClass(
    "border-rf-border",
    "bg-rf-surface",
    "text-rf-white"
  );
  ```
- warning tone (third test):
  ```ts
  expect(screen.getByTestId("score-pill")).toHaveClass(
    "border-rf-warning/40",
    "bg-rf-warning/10",
    "text-rf-warning"
  );
  ```

- [ ] **Step 2: Rewrite ScorePill**

Replace `src/components/ScorePill.tsx` with:

```tsx
import React from "react";

import { scoreToneStyles, type ScoreToneKey } from "@/lib/ui/status-styles";

type ScorePillProps = {
  label: string;
  value: number;
  tone?: ScoreToneKey;
};

export function ScorePill({ label, value, tone = "neutral" }: ScorePillProps) {
  return (
    <div
      className={`min-h-16 min-w-[7rem] rounded-md border px-3 py-2 ${scoreToneStyles[tone]}`}
      data-testid="score-pill"
      data-tone={tone}
    >
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-rf-muted">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums leading-none">{value.toFixed(2)}</div>
    </div>
  );
}
```

- [ ] **Step 3: Update SignalPanel test to expect rf tokens**

In `tests/signal-panel.test.tsx`, replace the `classes` arrays in the `it.each` table:

```ts
    {
      status: "pass",
      badge: "PASS",
      classes: ["border-rf-success/40", "bg-rf-success/10", "text-rf-success"]
    },
    {
      status: "warning",
      badge: "WARNING",
      classes: ["border-rf-warning/40", "bg-rf-warning/10", "text-rf-warning"]
    },
    {
      status: "fail",
      badge: "FAIL",
      classes: ["border-rf-danger/40", "bg-rf-danger/10", "text-rf-danger"]
    }
```

- [ ] **Step 4: Rewrite SignalPanel**

Replace `src/components/SignalPanel.tsx` with:

```tsx
import React from "react";

import { signalStatusStyles, type SignalStatusKey } from "@/lib/ui/status-styles";

export type SignalStatus = SignalStatusKey;

type SignalPanelProps = {
  title: string;
  status: SignalStatus;
  summary: string;
  evidence: string;
};

export function SignalPanel({ title, status, summary, evidence }: SignalPanelProps) {
  return (
    <section
      className={`rounded-md border p-5 [overflow-wrap:anywhere] ${signalStatusStyles[status]}`}
      data-testid="signal-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="min-w-0 break-words text-lg font-semibold">{title}</h2>
        <span className="rounded-sm border border-current px-2 py-1 text-xs font-semibold uppercase leading-none">
          {status.toUpperCase()}
        </span>
      </div>
      <p className="mt-3 break-words text-sm font-medium">{summary}</p>
      <p className="mt-3 whitespace-pre-line break-words text-sm leading-6">{evidence}</p>
    </section>
  );
}
```

- [ ] **Step 5: Rewrite WorkerStatusPanel**

Replace `src/components/WorkerStatusPanel.tsx` with (keep the exported `WorkerStatus` type — other modules import it):

```tsx
import React from "react";

import { workerStatusStyles } from "@/lib/ui/status-styles";

export type WorkerStatus = "online" | "offline" | "needs_auth" | "unknown";

type WorkerStatusPanelProps = {
  status: WorkerStatus;
};

const statusLabel: Record<WorkerStatus, string> = {
  online: "online",
  offline: "offline",
  needs_auth: "needs auth",
  unknown: "unknown"
};

export function WorkerStatusPanel({ status }: WorkerStatusPanelProps) {
  return (
    <div
      className={`inline-flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${workerStatusStyles[status]}`}
      data-testid="worker-status"
      role="status"
    >
      <span className="h-2 w-2 shrink-0 rounded-sm bg-current" aria-hidden="true" />
      <span className="min-w-0 break-words">Worker {statusLabel[status]}</span>
    </div>
  );
}
```

- [ ] **Step 6: Run affected tests**

Run: `npm test -- tests/score-pill.test.tsx tests/signal-panel.test.tsx tests/app-shell.test.tsx`
Expected: PASS. If `tests/app-shell.test.tsx` asserts old worker-status palette classes (emerald/rose/amber), update those assertions to the matching `workerStatusStyles` values for the status it renders.

- [ ] **Step 7: Commit**

```bash
git add src/components/ScorePill.tsx src/components/SignalPanel.tsx src/components/WorkerStatusPanel.tsx tests/score-pill.test.tsx tests/signal-panel.test.tsx
git commit -m "refactor: status components use rf token styles"
```

---

## Task 3: Worker-status helper + PageShell

**Files:**
- Create: `src/lib/workers/status.ts`
- Create: `src/components/PageShell.tsx`
- Create: `tests/worker-status.test.ts`

- [ ] **Step 1: Write the worker-status test**

Create `tests/worker-status.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

afterEach(() => {
  mocked.prisma = null;
});

describe("resolveWorkerStatusForUser", () => {
  it("reports offline when the user has no worker", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "no-worker@example.com" } });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("offline");
    });
  });

  it("reports online when the newest worker was seen recently", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "online@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id,
          label: "Local worker",
          tokenHash: "hash",
          status: "active",
          lastSeenAt: new Date()
        }
      });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("online");
    });
  });

  it("reports needs_auth when the newest worker needs auth", async () => {
    const { resolveWorkerStatusForUser } = await import("@/lib/workers/status");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "auth@example.com" } });
      await client.workerRegistration.create({
        data: {
          userId: user.id,
          label: "Local worker",
          tokenHash: "hash",
          status: "needs_auth",
          lastSeenAt: new Date()
        }
      });
      expect(await resolveWorkerStatusForUser(user.id)).toBe("needs_auth");
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/worker-status.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — `@/lib/workers/status` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/workers/status.ts`:

```ts
import type { WorkerStatus } from "@/components/WorkerStatusPanel";
import { prisma } from "@/lib/db";

const ONLINE_WINDOW_MS = 10 * 60 * 1000;

export async function resolveWorkerStatusForUser(userId: string): Promise<WorkerStatus> {
  const worker = await prisma.workerRegistration.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { status: true, lastSeenAt: true }
  });

  if (!worker) return "offline";
  if (worker.status === "needs_auth") return "needs_auth";
  if (worker.lastSeenAt && Date.now() - worker.lastSeenAt.getTime() <= ONLINE_WINDOW_MS) {
    return "online";
  }
  return "offline";
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/worker-status.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 5: Implement PageShell**

Create `src/components/PageShell.tsx`:

```tsx
import React from "react";
import type { Route } from "next";

import { AppShell } from "@/components/AppShell";
import { resolveWorkerStatusForUser } from "@/lib/workers/status";
import type { WorkerStatus } from "@/components/WorkerStatusPanel";

type PageShellProps = {
  currentUserId: string;
  currentUserName: string;
  activeSection: "inbox" | "profiles" | "jobs" | "workers";
  children: React.ReactNode;
};

function RightRail({ workerStatus }: { workerStatus: WorkerStatus }) {
  return (
    <div className="grid gap-3 text-sm text-rf-muted">
      <p className="text-xs font-semibold uppercase tracking-wide text-rf-muted">Worker</p>
      <p className="text-rf-white">Background AI execution runs on your local Codex worker.</p>
      <p>
        Status: <span className="font-semibold text-rf-white">{workerStatus.replace("_", " ")}</span>
      </p>
    </div>
  );
}

export async function PageShell({
  currentUserId,
  currentUserName,
  activeSection,
  children
}: PageShellProps) {
  const workerStatus = await resolveWorkerStatusForUser(currentUserId);
  const navItems = [
    { id: "inbox" as const, label: "Inbox", href: `/inbox/${currentUserId}` as Route },
    { id: "profiles" as const, label: "Profile", href: `/profiles/${currentUserId}` as Route },
    { id: "workers" as const, label: "Workers", href: "/workers" as Route }
  ];

  return (
    <AppShell
      currentUserName={currentUserName}
      workerStatus={workerStatus}
      activeSection={activeSection}
      navItems={navItems}
      rightRail={<RightRail workerStatus={workerStatus} />}
    >
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/workers/status.ts src/components/PageShell.tsx tests/worker-status.test.ts
git commit -m "feat: add worker-status helper and PageShell wrapper"
```

---

## Task 4: Migrate PaperCard and DispatchForm to rf tokens

**Files:**
- Modify: `src/components/PaperCard.tsx`, `src/components/DispatchForm.tsx`

> Note: `PaperCard` belongs to the legacy heuristic inbox path and is not on the v2 inbox screen, but it must still obey the design system so the regression guard (Task 16) passes.

- [ ] **Step 1: Rewrite PaperCard markup colors**

In `src/components/PaperCard.tsx`, replace the `return (...)` block (lines 101-177) with the rf-token version below. Logic above it is unchanged.

```tsx
  return (
    <article className="rounded-md border border-rf-border bg-rf-panel p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-3xl flex-1">
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-rf-muted">
            <span className="min-w-0 truncate">{authors.slice(0, 3).join(", ")}</span>
            <span>Source: arXiv</span>
            <span>{item.paper.publishedAt.toISOString().slice(0, 10)}</span>
            <span className="min-w-0 truncate">{categories.join(", ")}</span>
          </div>
          <h2 className="text-xl font-semibold leading-tight text-rf-white">{item.paper.title}</h2>
          <p className="mt-2 text-sm leading-6 text-rf-muted">{item.paper.abstract}</p>

          <div className="mt-4 rounded-md border border-rf-border bg-rf-surface p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-rf-muted">Best idea</div>
            <h3 className="mt-1 font-semibold text-rf-white">{item.bestIdea.title}</h3>
            <p className="mt-1 text-sm leading-6 text-rf-muted">{item.bestIdea.summary}</p>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:w-64 lg:w-64 lg:flex-none">
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

      <details className="mt-4 rounded-md border border-rf-border p-3">
        <summary className="cursor-pointer text-sm font-semibold text-rf-white">
          Expandable reasoning
        </summary>
        <div className="mt-3 grid gap-3 text-sm leading-6 text-rf-muted md:grid-cols-2">
          <p>
            <strong className="text-rf-white">Why it matters:</strong> {reasoning.whyPaperMatters}
          </p>
          <p>
            <strong className="text-rf-white">Why promising:</strong> {reasoning.whyIdeaPromising}
          </p>
          <p>
            <strong className="text-rf-white">Trap risk:</strong> {reasoning.whyItMightBeTrap}
          </p>
          <p>
            <strong className="text-rf-white">Smallest sprint:</strong> {reasoning.smallestSprint}
          </p>
          <p>
            <strong className="text-rf-white">Suggested depth:</strong> {reasoning.suggestedDepth}
          </p>
          <p>
            <strong className="text-rf-white">Suggested autonomy:</strong> {reasoning.suggestedAutonomy}
          </p>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          className="rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-violetSoft"
          href={dispatchHref}
        >
          Dispatch viability sprint
        </Link>
        <a
          className="rounded-md border border-rf-border px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-surface"
          href={item.paper.url}
          target="_blank"
          rel="noreferrer"
        >
          Open source paper
        </a>
      </div>
    </article>
  );
```

- [ ] **Step 2: Rewrite DispatchForm**

Replace `src/components/DispatchForm.tsx`'s returned JSX with rf tokens (imports and props unchanged):

```tsx
  return (
    <form action={startDispatch} className="grid gap-6 rounded-md border border-rf-border bg-rf-panel p-6">
      {ideaId ? <input type="hidden" name="ideaId" value={ideaId} /> : null}
      {generatedIdeaId ? (
        <input type="hidden" name="generatedIdeaId" value={generatedIdeaId} />
      ) : null}

      <section>
        <h2 className="text-lg font-semibold text-rf-white">Sprint depth</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {SPRINT_DEPTHS.map((key) => {
            const config = sprintDepthConfig[key];
            return (
              <label key={key} className="rounded-md border border-rf-border bg-rf-surface p-3 text-rf-white">
                <input
                  className="mr-2"
                  type="radio"
                  name="sprintDepth"
                  value={key}
                  defaultChecked={key === suggestedDepth}
                />
                <span className="font-semibold capitalize">{key}</span>
                <p className="mt-1 text-sm text-rf-muted">{config.expectedDuration}</p>
                <p className="mt-1 text-sm text-rf-muted">{config.description}</p>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-rf-white">Autonomy</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {AUTONOMY_LEVELS.map((key) => {
            const config = autonomyConfig[key];
            return (
              <label key={key} className="rounded-md border border-rf-border bg-rf-surface p-3 text-rf-white">
                <input
                  className="mr-2"
                  type="radio"
                  name="autonomyLevel"
                  value={key}
                  defaultChecked={key === suggestedAutonomy}
                />
                <span className="font-semibold capitalize">{key}</span>
                <p className="mt-1 text-sm text-rf-muted">{config.description}</p>
              </label>
            );
          })}
        </div>
      </section>

      <div className="rounded-md border border-rf-warning/40 bg-rf-warning/10 p-3 text-sm text-rf-warning">
        Medium and high autonomy may create artifacts or run experiments. High autonomy should only be
        used after budget limits are configured.
      </div>

      <button className="w-fit rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-violetSoft">
        Start viability sprint
      </button>
    </form>
  );
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit --pretty false`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/PaperCard.tsx src/components/DispatchForm.tsx
git commit -m "refactor: PaperCard and DispatchForm use rf tokens"
```

---

## Task 5: Migrate the dispatch page + wrap in PageShell

**Files:**
- Modify: `src/app/dispatch/[ideaId]/page.tsx`

- [ ] **Step 1: Replace both render branches with rf tokens inside PageShell**

In `src/app/dispatch/[ideaId]/page.tsx`:

1. Add import near the top:
   ```ts
   import { PageShell } from "@/components/PageShell";
   ```
2. Replace the generated-idea `return (...)` (the block starting `<main className="min-h-screen bg-paper ...">` at line 108) with:

```tsx
    return (
      <PageShell
        currentUserId={currentUser.id}
        currentUserName={currentUser.name ?? "Researcher"}
        activeSection="inbox"
      >
        <div className="mx-auto max-w-5xl">
          <header className="mb-6">
            <p className="text-sm font-medium uppercase tracking-wide text-rf-muted">Dispatch setup</p>
            <h1 className="text-3xl font-semibold text-rf-white">{generatedIdea.title}</h1>
            <p className="mt-2 text-rf-muted">{generatedIdea.summary}</p>
          </header>

          <section className="mb-6 rounded-md border border-rf-border bg-rf-panel p-5">
            <h2 className="font-semibold text-rf-white">Generated idea details</h2>
            <p className="mt-2 text-sm leading-6 text-rf-muted">{generatedIdea.expandedExplanation}</p>
            <p className="mt-3 text-sm text-rf-muted">
              <strong className="text-rf-white">Trajectory:</strong> {generatedIdea.trajectory}
            </p>
            <p className="mt-2 text-sm text-rf-muted">
              <strong className="text-rf-white">Smallest sprint:</strong> {generatedIdea.smallestSprint}
            </p>
          </section>

          <section className="mb-6 rounded-md border border-rf-border bg-rf-panel p-5">
            <h2 className="font-semibold text-rf-white">Source paper</h2>
            <p className="mt-1 text-rf-white">{generatedIdea.paper.title}</p>
            <p className="mt-2 text-sm text-rf-muted">{generatedIdea.paper.abstract}</p>
            <a
              className="mt-3 inline-flex text-sm font-semibold text-rf-violetSoft hover:text-rf-white"
              href={generatedIdea.paper.url}
              target="_blank"
              rel="noreferrer"
            >
              Open source paper
            </a>
          </section>

          {generatedIdea.citations.length > 0 ? (
            <section className="mb-6 rounded-md border border-rf-border bg-rf-panel p-5">
              <h2 className="font-semibold text-rf-white">Supporting citations</h2>
              <div className="mt-3 grid gap-3">
                {generatedIdea.citations.map((citation) => (
                  <a
                    key={citation.id}
                    className="block rounded-md border border-rf-border p-3 text-sm text-rf-muted hover:bg-rf-surface"
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="font-semibold text-rf-white">{citation.title}</span>
                    <span className="mt-1 block text-rf-muted">{citation.claim}</span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <DispatchForm
            generatedIdeaId={generatedIdea.id}
            suggestedDepth={suggestedDepth}
            suggestedAutonomy="medium"
          />
        </div>
      </PageShell>
    );
```

3. Replace the legacy-idea `return (...)` (the block starting `<main className="min-h-screen bg-paper ...">` at line 194) with:

```tsx
  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="inbox"
    >
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-rf-muted">Dispatch setup</p>
          <h1 className="text-3xl font-semibold text-rf-white">{idea.title}</h1>
          <p className="mt-2 text-rf-muted">{idea.summary}</p>
        </header>

        <section className="mb-6 rounded-md border border-rf-border bg-rf-panel p-5">
          <h2 className="font-semibold text-rf-white">Source paper</h2>
          <p className="mt-1 text-rf-white">{idea.paper.title}</p>
          <p className="mt-2 text-sm text-rf-muted">{idea.paper.abstract}</p>
        </section>

        <DispatchForm
          ideaId={idea.id}
          suggestedDepth={reasoning.suggestedDepth}
          suggestedAutonomy={reasoning.suggestedAutonomy}
        />
      </div>
    </PageShell>
  );
```

> `currentUser` here only has `{ id }` in some tests; `currentUser.name` is `undefined` then, so `?? "Researcher"` is required. `requireCurrentUser` returns the full user in production.

- [ ] **Step 2: Update the dispatch page tests' Prisma mock for worker status**

In `tests/app-page-auth.test.ts`, add `workerRegistration` to the hoisted `prisma` mock so PageShell can resolve status during render-path tests:

```ts
    workerRegistration: {
      findFirst: vi.fn()
    },
```

And in `beforeEach`, default it to null:

```ts
    mocked.prisma.workerRegistration.findFirst.mockResolvedValue(null);
```

- [ ] **Step 3: Run dispatch-related tests**

Run: `npm test -- tests/app-page-auth.test.ts`
Expected: PASS (the dispatch "loads dispatch setup" test renders the legacy branch through PageShell; the "another user" test still throws NEXT_NOT_FOUND before rendering).

- [ ] **Step 4: Commit**

```bash
git add "src/app/dispatch/[ideaId]/page.tsx" tests/app-page-auth.test.ts
git commit -m "refactor: dispatch page uses dark shell and rf tokens"
```

---

## Task 6: Migrate the jobs page + wrap in PageShell

**Files:**
- Modify: `src/app/jobs/[jobId]/page.tsx`

- [ ] **Step 1: Add the import and replace the outer wrapper + colors**

In `src/app/jobs/[jobId]/page.tsx`:

1. Add import:
   ```ts
   import { PageShell } from "@/components/PageShell";
   ```
2. Replace the outer `<main className="min-h-screen bg-paper text-ink [color-scheme:light]"><div className="mx-auto max-w-6xl px-6 py-8">` … closing `</div></main>` (lines 149-357) so the content is wrapped by:
   ```tsx
   <PageShell
     currentUserId={currentUser.id}
     currentUserName={currentUser.name ?? "Researcher"}
     activeSection="jobs"
   >
     <div className="mx-auto max-w-6xl">
       ... existing inner content ...
     </div>
   </PageShell>
   ```
3. Apply these exact class replacements throughout the inner content:
   - `text-slate-500` → `text-rf-muted`
   - `text-slate-600` → `text-rf-muted`
   - `text-slate-700` → `text-rf-muted`
   - `text-slate-900` → `text-rf-white`
   - `bg-white` → `bg-rf-panel`
   - `border-slate-200` → `border-rf-border`
   - `border-slate-300` → `border-rf-border`
   - `bg-slate-50` → `bg-rf-surface`
   - The incomplete-sprint banner `border-amber-200 bg-amber-50 ... text-amber-900` → `border-rf-warning/40 bg-rf-warning/10 text-rf-warning`
   - The selected-verdict chip `border-emerald-300 bg-emerald-50 ... text-emerald-800` → `border-rf-success/40 bg-rf-success/10 text-rf-success`
   - The unselected-verdict chip `border-slate-200 bg-slate-50 ... text-slate-600` → `border-rf-border bg-rf-surface text-rf-muted`
   - Disabled action buttons `border-slate-300 ... text-slate-700` → `border-rf-border text-rf-muted`
   - "Back to inbox" link `text-slate-700 underline` → `text-rf-violetSoft underline hover:text-rf-white`
   - Any artifact `<pre>` `bg-slate-50 ... text-slate-700` → `bg-rf-surface text-rf-muted`

   The `SignalPanel` children already render correct status colors from Task 2; leave them.

- [ ] **Step 2: Run jobs page tests**

Run: `npm test -- tests/app-page-auth.test.ts`
Expected: PASS. The "renders v2 viability report fields" and "incomplete v2 jobs" tests render through PageShell (worker-status mock returns null from Task 5 Step 2). All asserted text is unchanged, so assertions still pass.

- [ ] **Step 3: Commit**

```bash
git add "src/app/jobs/[jobId]/page.tsx"
git commit -m "refactor: jobs page uses dark shell and rf tokens"
```

---

## Task 7: Migrate WorkerSetupContent + workers page

**Files:**
- Modify: `src/components/WorkerSetupContent.tsx`, `src/app/workers/page.tsx`

- [ ] **Step 1: Recolor WorkerSetupContent**

In `src/components/WorkerSetupContent.tsx` apply these exact replacements (keep `"use client"`, logic, and the outer `<div className="mx-auto max-w-5xl px-6 py-8">` — the workers page provides the shell):
- `text-slate-500` → `text-rf-muted`
- `text-slate-600` → `text-rf-muted`
- `text-slate-900` → `text-rf-white`
- `border-line` → `border-rf-border`
- `bg-white` → `bg-rf-panel`
- Create-token button `bg-slate-950 ... text-white disabled:... disabled:bg-slate-500` → `bg-rf-violet text-rf-white transition-colors hover:bg-rf-violetSoft disabled:cursor-not-allowed disabled:bg-rf-border`
- Command `<pre className="... bg-slate-950 ... text-slate-50">` → `bg-rf-surface text-rf-white`
- Empty-state box `border-slate-200 bg-slate-50 ... text-slate-600` → `border-rf-border bg-rf-surface text-rf-muted`
- Table head `border-slate-200 text-slate-500` → `border-rf-border text-rf-muted`
- Table body `divide-slate-100 text-slate-700` → `divide-rf-border text-rf-muted`
- `font-medium text-slate-900` (worker label cell) → `font-medium text-rf-white`

- [ ] **Step 2: Wrap the workers page in PageShell**

Replace the `return (...)` of `src/app/workers/page.tsx` so the content is inside the shell:

```tsx
import React from "react";
import { headers } from "next/headers";

import { PageShell } from "@/components/PageShell";
import { WorkerSetupContent } from "@/components/WorkerSetupContent";
import { registerWorker } from "@/app/workers/actions";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { resolveWorkerSetupAppUrl } from "@/lib/jobs/worker-setup-url";

export default async function WorkersPage() {
  const currentUser = await requireCurrentUser();
  const [headerList, workers] = await Promise.all([
    headers(),
    prisma.workerRegistration.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        revokedAt: true
      }
    })
  ]);

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="workers"
    >
      <WorkerSetupContent
        appUrl={resolveWorkerSetupAppUrl(headerList)}
        workers={workers}
        registrationAction={registerWorker}
        registrationResult={null}
      />
    </PageShell>
  );
}
```

- [ ] **Step 3: Run the worker setup page test**

Run: `npm test -- tests/worker-setup-page.test.tsx`
Expected: PASS. If the test mocks `prisma` without `workerRegistration.findFirst`, add `findFirst: vi.fn().mockResolvedValue(null)` to its mock so PageShell can resolve status. If it mocks `requireCurrentUser`, ensure it returns an object with `id`.

- [ ] **Step 4: Commit**

```bash
git add src/components/WorkerSetupContent.tsx src/app/workers/page.tsx tests/worker-setup-page.test.tsx
git commit -m "refactor: worker setup uses dark shell and rf tokens"
```

---

## Task 8: Migrate the profiles page + wrap in PageShell

**Files:**
- Modify: `src/app/profiles/[userId]/page.tsx`

> The `ProfileForm`/`ProfileReadOnly` components are recolored in Task 11. This task only fixes the page wrapper and header colors.

- [ ] **Step 1: Replace the page wrapper and header colors**

Replace the `return (...)` of `src/app/profiles/[userId]/page.tsx` with:

```tsx
  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="profiles"
    >
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-rf-muted">
            Research profile
          </p>
          <h1 className="text-3xl font-semibold text-rf-white">{targetUser.name}</h1>
          <p className="mt-2 text-rf-muted">
            Tune source discovery, runtime limits, and worker research behavior.
          </p>
        </header>

        {editable && profile ? (
          <ProfileForm
            profile={profile}
            saveAction={async (formData) => {
              "use server";
              formData.set("userId", userId);
              await saveProfile(formData);
            }}
          />
        ) : profile ? (
          <ProfileReadOnly profile={profile} />
        ) : (
          <div className="rounded-md border border-rf-border bg-rf-panel p-5 text-rf-muted">
            No research profile has been configured yet.
          </div>
        )}
      </div>
    </PageShell>
  );
```

Add the import at the top:
```ts
import { PageShell } from "@/components/PageShell";
```

- [ ] **Step 2: Run the profile render tests**

Run: `npm test -- tests/app-page-auth.test.ts`
Expected: PASS. The read-only and missing-profile profile tests render through PageShell with the null worker-status mock; asserted text is unchanged.

- [ ] **Step 3: Commit**

```bash
git add "src/app/profiles/[userId]/page.tsx"
git commit -m "refactor: profiles page uses dark shell"
```

---

## Task 9: Add biology and economics field presets

**Files:**
- Modify: `src/lib/profiles/field-presets.ts`
- Modify: `tests/profile-presets.test.ts`

- [ ] **Step 1: Add a failing test for the new presets**

Append inside the `describe("field presets", ...)` block in `tests/profile-presets.test.ts`:

```ts
  it("includes biology and economics presets that map to their arXiv categories", () => {
    expect(fieldPresets.biology.categories).toEqual(["q-bio.BM", "q-bio.GN", "q-bio.NC"]);
    expect(fieldPresets.economics.categories).toEqual(["econ.EM", "econ.GN", "q-fin.EC"]);

    for (const category of fieldPresets.biology.categories) {
      expect(fieldPresets.biology.defaultArxivQuery).toContain(`cat:${category}`);
    }
    for (const category of fieldPresets.economics.categories) {
      expect(fieldPresets.economics.defaultArxivQuery).toContain(`cat:${category}`);
    }
  });

  it("treats biology and economics as valid field preset keys", () => {
    expect(isFieldPresetKey("biology")).toBe(true);
    expect(isFieldPresetKey("economics")).toBe(true);
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/profile-presets.test.ts`
Expected: FAIL — `fieldPresets.biology`/`fieldPresets.economics` are undefined.

- [ ] **Step 3: Add the two presets**

In `src/lib/profiles/field-presets.ts`, add these two entries to the `fieldPresets` object after `chemistry` (before the closing `} as const;`):

```ts
  biology: {
    label: "Biology",
    categories: ["q-bio.BM", "q-bio.GN", "q-bio.NC"],
    defaultArxivQuery:
      "(cat:q-bio.BM OR cat:q-bio.GN OR cat:q-bio.NC) AND (all:protein OR all:genomics OR all:sequencing OR all:neural OR all:modeling)",
    interests: [
      "computational biology",
      "genomics",
      "protein structure",
      "systems biology",
      "neuroscience modeling"
    ],
    keywords: [
      "genomics",
      "protein structure prediction",
      "single-cell analysis",
      "systems biology",
      "biological sequence models"
    ],
    constraints: [
      "Prefer methods with public biological datasets",
      "Favor analyses that need no new wet-lab data",
      "Avoid projects requiring proprietary clinical data"
    ],
    preferredOutputs: [
      "analysis pipeline",
      "benchmark",
      "reproducible notebook",
      "open dataset"
    ]
  },
  economics: {
    label: "Economics",
    categories: ["econ.EM", "econ.GN", "q-fin.EC"],
    defaultArxivQuery:
      "(cat:econ.EM OR cat:econ.GN OR cat:q-fin.EC) AND (all:causal OR all:estimation OR all:market OR all:policy OR all:forecasting)",
    interests: [
      "econometrics",
      "causal inference",
      "market design",
      "economic forecasting",
      "policy evaluation"
    ],
    keywords: [
      "causal inference",
      "econometric estimation",
      "market design",
      "economic forecasting",
      "policy evaluation"
    ],
    constraints: [
      "Prefer methods with public economic datasets",
      "Favor reproducible empirical designs",
      "Avoid claims that need proprietary firm data"
    ],
    preferredOutputs: [
      "empirical study",
      "reproducible analysis",
      "open dataset",
      "policy brief"
    ]
  }
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- tests/profile-presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profiles/field-presets.ts tests/profile-presets.test.ts
git commit -m "feat: add biology and economics field presets"
```

---

## Task 10: Fix profile interests persistence bug

**Files:**
- Modify: `src/lib/profiles/service.ts`
- Modify: `src/app/profiles/[userId]/actions.ts`
- Create: `tests/profile-service.test.ts`

> `updateOwnProfile` currently writes `interestsJson: JSON.stringify(input.keywords)`, clobbering interests with keywords on every save. Fix it to persist a real `interests` value.

- [ ] **Step 1: Write a failing service test**

Create `tests/profile-service.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

afterEach(() => {
  mocked.prisma = null;
});

describe("updateOwnProfile", () => {
  it("persists interests independently from keywords", async () => {
    const { updateOwnProfile } = await import("@/lib/profiles/service");
    const { ensureProfileForUser } = await import("@/lib/profiles/service");

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "owner@example.com" } });
      await ensureProfileForUser(user.id, "ai_ml");

      await updateOwnProfile({
        currentUserId: user.id,
        targetUserId: user.id,
        fieldPresetKey: "ai_ml",
        keywords: ["agent evaluation"],
        interests: ["long-horizon agents"],
        preferredOutputs: ["benchmark"],
        constraints: ["no frontier training"],
        arxivQuery: "cat:cs.AI"
      });

      const saved = await client.researchProfile.findUniqueOrThrow({ where: { userId: user.id } });
      expect(JSON.parse(saved.keywordsJson)).toEqual(["agent evaluation"]);
      expect(JSON.parse(saved.interestsJson)).toEqual(["long-horizon agents"]);
    });
  });

  it("defaults interests to keywords when interests are not provided", async () => {
    const { updateOwnProfile, ensureProfileForUser } = await import("@/lib/profiles/service");

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "owner2@example.com" } });
      await ensureProfileForUser(user.id, "ai_ml");

      await updateOwnProfile({
        currentUserId: user.id,
        targetUserId: user.id,
        keywords: ["agent evaluation"],
        preferredOutputs: ["benchmark"],
        constraints: [],
        arxivQuery: "cat:cs.AI"
      });

      const saved = await client.researchProfile.findUniqueOrThrow({ where: { userId: user.id } });
      expect(JSON.parse(saved.interestsJson)).toEqual(["agent evaluation"]);
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/profile-service.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — the first test fails because `interestsJson` equals keywords; `interests` is not yet a field on `ProfileUpdateData`.

- [ ] **Step 3: Add `interests` to ProfileUpdateData and persist it**

In `src/lib/profiles/service.ts`:

1. Add `interests` to `ProfileUpdateData`:
   ```ts
   export type ProfileUpdateData = {
     fieldPresetKey?: FieldPresetKey;
     keywords: string[];
     interests?: string[];
     preferredOutputs: string[];
     constraints: string[];
     arxivQuery: string;
     normalDailyRuntimeMin?: number;
     maxDailyRuntimeMin?: number;
     maxPapersScreened?: number;
     maxPapersDeepRead?: number;
     allowPdfFetch?: boolean;
     allowRelatedWorkSearch?: boolean;
   };
   ```
2. In `updateOwnProfile`, change the `interestsJson` line from:
   ```ts
       interestsJson: JSON.stringify(input.keywords),
   ```
   to:
   ```ts
       interestsJson: JSON.stringify(input.interests ?? input.keywords),
   ```

- [ ] **Step 4: Pass interests through the save action**

In `src/app/profiles/[userId]/actions.ts`, inside the `updateOwnProfile({ ... })` call, add an `interests` line after `keywords`:

```ts
    keywords: parseList(formData.get("keywords")),
    interests: parseList(formData.get("interests")),
```

> The form does not yet submit an `interests` field, so `parseList` returns `[]` and `updateOwnProfile` falls back to keywords — preserving today's behavior until an interests input is added. (No interests input is added in this plan; the fix simply stops the clobber and makes the field available.)

Because `parseList(...)` returns `[]` (falsy-empty) when absent, and `[]` is not `undefined`, adjust the fallback so an empty interests list still falls back to keywords. Change the service line to:

```ts
      interestsJson: JSON.stringify(
        input.interests && input.interests.length > 0 ? input.interests : input.keywords
      ),
```

- [ ] **Step 5: Run the test and verify it passes**

Run:
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/profile-service.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/profiles/service.ts "src/app/profiles/[userId]/actions.ts" tests/profile-service.test.ts
git commit -m "fix: persist profile interests independently from keywords"
```

---

## Task 11: Reactive ProfileForm (client component) + rf tokens

**Files:**
- Modify: `src/components/ProfileForm.tsx`
- Modify: `tests/profile-form.test.tsx`

- [ ] **Step 1: Add a failing reactivity test**

Append inside `describe("ProfileForm", ...)` in `tests/profile-form.test.tsx` (and add `fireEvent` to the testing-library import: `import { fireEvent, render, screen } from "@testing-library/react";`):

```ts
  it("repopulates query, keywords, outputs, and constraints when the field preset changes", () => {
    render(
      <ProfileForm
        profile={{
          fieldPresetKey: "ai_ml",
          keywords: ["LLM evaluation"],
          preferredOutputs: ["benchmark"],
          constraints: ["Avoid frontier-scale model training"],
          arxivQuery: "cat:cs.AI AND all:evaluation",
          normalDailyRuntimeMin: 45,
          maxDailyRuntimeMin: 120,
          maxPapersScreened: 40,
          maxPapersDeepRead: 6,
          allowPdfFetch: false,
          allowRelatedWorkSearch: true
        }}
        saveAction={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Field preset"), { target: { value: "chemistry" } });

    expect(screen.getByLabelText("Field preset")).toHaveValue("chemistry");
    expect(screen.getByLabelText("arXiv query")).toHaveValue(
      "(cat:physics.chem-ph OR cat:cond-mat.mtrl-sci OR cat:q-bio.BM) AND (all:catalysis OR all:synthesis OR all:materials OR all:molecule OR all:screening)"
    );
    expect(screen.getByLabelText("Keywords")).toHaveValue(
      "catalysis\nmolecular screening\nmaterials discovery\ncomputational chemistry\nbiomolecular modeling"
    );
    expect(screen.getByLabelText("Preferred outputs")).toHaveValue(
      "screening workflow\ncandidate ranking\nreproducible notebook\nexperimental validation plan"
    );
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/profile-form.test.tsx`
Expected: FAIL — changing the preset does not currently update the fields (uncontrolled inputs).

- [ ] **Step 3: Rewrite ProfileForm as a reactive client component**

Replace `src/components/ProfileForm.tsx` entirely with:

```tsx
"use client";

import React, { useState } from "react";

import { fieldPresets, type FieldPresetKey } from "@/lib/profiles/field-presets";
import type { EditableProfileData } from "@/lib/profiles/service";

type ProfileFormProps = {
  profile: EditableProfileData;
  saveAction: (formData: FormData) => void | Promise<void>;
};

type ProfileReadOnlyProps = {
  profile: EditableProfileData;
};

function lines(values: readonly string[]) {
  return values.join("\n");
}

const labelClass = "grid gap-2 text-sm font-medium text-rf-muted";
const fieldClass =
  "rounded-md border border-rf-border bg-rf-surface px-3 py-2 text-rf-white placeholder:text-rf-muted focus:border-rf-violetSoft focus:outline-none";

export function ProfileForm({ profile, saveAction }: ProfileFormProps) {
  const [fieldPresetKey, setFieldPresetKey] = useState<FieldPresetKey>(profile.fieldPresetKey);
  const [keywords, setKeywords] = useState(lines(profile.keywords));
  const [preferredOutputs, setPreferredOutputs] = useState(lines(profile.preferredOutputs));
  const [constraints, setConstraints] = useState(lines(profile.constraints));
  const [arxivQuery, setArxivQuery] = useState(profile.arxivQuery);

  function applyPreset(key: FieldPresetKey) {
    setFieldPresetKey(key);
    const preset = fieldPresets[key];
    setKeywords(lines(preset.keywords));
    setPreferredOutputs(lines(preset.preferredOutputs));
    setConstraints(lines(preset.constraints));
    setArxivQuery(preset.defaultArxivQuery);
  }

  return (
    <form action={saveAction} className="grid gap-5 rounded-md border border-rf-border bg-rf-panel p-5">
      <label className={labelClass}>
        Field preset
        <select
          name="fieldPresetKey"
          value={fieldPresetKey}
          onChange={(event) => applyPreset(event.target.value as FieldPresetKey)}
          className={fieldClass}
        >
          {(Object.entries(fieldPresets) as [FieldPresetKey, (typeof fieldPresets)[FieldPresetKey]][]).map(
            ([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            )
          )}
        </select>
      </label>

      <label className={labelClass}>
        Keywords
        <textarea
          name="keywords"
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          rows={5}
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        Preferred outputs
        <textarea
          name="preferredOutputs"
          value={preferredOutputs}
          onChange={(event) => setPreferredOutputs(event.target.value)}
          rows={4}
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        Constraints
        <textarea
          name="constraints"
          value={constraints}
          onChange={(event) => setConstraints(event.target.value)}
          rows={4}
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        arXiv query
        <textarea
          name="arxivQuery"
          value={arxivQuery}
          onChange={(event) => setArxivQuery(event.target.value)}
          rows={4}
          className={`${fieldClass} font-mono text-sm`}
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          Normal daily runtime minutes
          <input
            name="normalDailyRuntimeMin"
            type="number"
            min={0}
            defaultValue={profile.normalDailyRuntimeMin}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Maximum daily runtime minutes
          <input
            name="maxDailyRuntimeMin"
            type="number"
            min={0}
            defaultValue={profile.maxDailyRuntimeMin}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Maximum papers screened
          <input
            name="maxPapersScreened"
            type="number"
            min={0}
            defaultValue={profile.maxPapersScreened}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Maximum papers deep read
          <input
            name="maxPapersDeepRead"
            type="number"
            min={0}
            defaultValue={profile.maxPapersDeepRead}
            className={fieldClass}
          />
        </label>
      </div>

      <div className="grid gap-3">
        <label className="flex items-center gap-3 text-sm font-medium text-rf-muted">
          <input name="allowPdfFetch" type="checkbox" defaultChecked={profile.allowPdfFetch} />
          Allow PDF fetch
        </label>
        <label className="flex items-center gap-3 text-sm font-medium text-rf-muted">
          <input
            name="allowRelatedWorkSearch"
            type="checkbox"
            defaultChecked={profile.allowRelatedWorkSearch}
          />
          Allow related-work search
        </label>
      </div>

      <button
        type="submit"
        className="w-fit rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-violetSoft"
      >
        Save profile
      </button>
    </form>
  );
}

function ListValue({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <p className="text-rf-muted">None configured</p>;
  }

  return (
    <ul className="grid gap-1">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

export function ProfileReadOnly({ profile }: ProfileReadOnlyProps) {
  return (
    <section className="grid gap-5 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
      <div>
        <h2 className="font-semibold text-rf-white">Field preset</h2>
        <p className="mt-1">{fieldPresets[profile.fieldPresetKey].label}</p>
      </div>
      <div>
        <h2 className="font-semibold text-rf-white">Keywords</h2>
        <div className="mt-1">
          <ListValue values={profile.keywords} />
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-rf-white">Preferred outputs</h2>
        <div className="mt-1">
          <ListValue values={profile.preferredOutputs} />
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-rf-white">Constraints</h2>
        <div className="mt-1">
          <ListValue values={profile.constraints} />
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-rf-white">arXiv query</h2>
        <p className="mt-1 whitespace-pre-wrap font-mono text-rf-white">{profile.arxivQuery}</p>
      </div>
      <dl className="grid gap-4 md:grid-cols-2">
        <div>
          <dt className="font-semibold text-rf-white">Normal daily runtime minutes</dt>
          <dd className="mt-1">{profile.normalDailyRuntimeMin}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">Maximum daily runtime minutes</dt>
          <dd className="mt-1">{profile.maxDailyRuntimeMin}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">Maximum papers screened</dt>
          <dd className="mt-1">{profile.maxPapersScreened}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">Maximum papers deep read</dt>
          <dd className="mt-1">{profile.maxPapersDeepRead}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">PDF fetch</dt>
          <dd className="mt-1">{profile.allowPdfFetch ? "Allowed" : "Disabled"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">Related-work search</dt>
          <dd className="mt-1">{profile.allowRelatedWorkSearch ? "Allowed" : "Disabled"}</dd>
        </div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 4: Run the form tests**

Run: `npm test -- tests/profile-form.test.tsx`
Expected: PASS (both the original render test and the new reactivity test).

- [ ] **Step 5: Commit**

```bash
git add src/components/ProfileForm.tsx tests/profile-form.test.tsx
git commit -m "feat: reactive field preset in profile editor"
```

---

## Task 12: First-run field onboarding

**Files:**
- Create: `src/components/OnboardingPicker.tsx`
- Create: `src/app/onboarding/actions.ts`
- Create: `src/app/onboarding/page.tsx`
- Modify: `src/app/page.tsx`
- Create: `tests/onboarding.test.ts`
- Modify: `tests/app-page-auth.test.ts`

- [ ] **Step 1: Write the onboarding/home routing test**

Create `tests/onboarding.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  ensureProfileForUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  prisma: {
    researchProfile: { findUnique: vi.fn() }
  }
}));

vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: mocked.requireCurrentUser }));
vi.mock("@/lib/profiles/service", () => ({ ensureProfileForUser: mocked.ensureProfileForUser }));
vi.mock("@/lib/db", () => ({ prisma: mocked.prisma }));
vi.mock("next/navigation", () => ({ redirect: mocked.redirect }));

describe("home routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a user without a profile to onboarding", async () => {
    const { default: HomePage } = await import("@/app/page");
    mocked.requireCurrentUser.mockResolvedValue({ id: "u1" });
    mocked.prisma.researchProfile.findUnique.mockResolvedValue(null);

    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
    expect(mocked.ensureProfileForUser).not.toHaveBeenCalled();
  });

  it("sends a user with a profile to their inbox", async () => {
    const { default: HomePage } = await import("@/app/page");
    mocked.requireCurrentUser.mockResolvedValue({ id: "u1" });
    mocked.prisma.researchProfile.findUnique.mockResolvedValue({ userId: "u1" });

    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/inbox/u1");
  });
});

describe("onboarding submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a profile from the chosen preset and redirects to inbox", async () => {
    const { chooseField } = await import("@/app/onboarding/actions");
    mocked.requireCurrentUser.mockResolvedValue({ id: "u1" });
    mocked.ensureProfileForUser.mockResolvedValue({ userId: "u1" });

    const formData = new FormData();
    formData.set("fieldPresetKey", "biology");

    await expect(chooseField(formData)).rejects.toThrow("NEXT_REDIRECT:/inbox/u1");
    expect(mocked.ensureProfileForUser).toHaveBeenCalledWith("u1", "biology");
  });

  it("falls back to ai_ml when an invalid preset is submitted", async () => {
    const { chooseField } = await import("@/app/onboarding/actions");
    mocked.requireCurrentUser.mockResolvedValue({ id: "u1" });
    mocked.ensureProfileForUser.mockResolvedValue({ userId: "u1" });

    const formData = new FormData();
    formData.set("fieldPresetKey", "not-a-field");

    await expect(chooseField(formData)).rejects.toThrow("NEXT_REDIRECT:/inbox/u1");
    expect(mocked.ensureProfileForUser).toHaveBeenCalledWith("u1", "ai_ml");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/onboarding.test.ts`
Expected: FAIL — `@/app/onboarding/actions` and the new home logic do not exist.

- [ ] **Step 3: Implement the onboarding server action**

Create `src/app/onboarding/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { ensureProfileForUser } from "@/lib/profiles/service";
import { isFieldPresetKey } from "@/lib/profiles/field-presets";

export async function chooseField(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const submitted = String(formData.get("fieldPresetKey") || "");
  const presetKey = isFieldPresetKey(submitted) ? submitted : "ai_ml";

  await ensureProfileForUser(currentUser.id, presetKey);
  redirect(`/inbox/${currentUser.id}`);
}
```

- [ ] **Step 4: Implement the onboarding picker component**

Create `src/components/OnboardingPicker.tsx`:

```tsx
import React from "react";

import { fieldPresets, type FieldPresetKey } from "@/lib/profiles/field-presets";

type OnboardingPickerProps = {
  chooseAction: (formData: FormData) => void | Promise<void>;
};

export function OnboardingPicker({ chooseAction }: OnboardingPickerProps) {
  const presets = Object.entries(fieldPresets) as [
    FieldPresetKey,
    (typeof fieldPresets)[FieldPresetKey]
  ][];

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-rf-muted">Research Finder</p>
        <h1 className="mt-1 text-3xl font-semibold text-rf-white">Choose your research field</h1>
        <p className="mt-2 text-rf-muted">
          This sets your default arXiv categories and keywords. You can fine-tune everything later in
          your profile.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {presets.map(([key, preset]) => (
          <form action={chooseAction} key={key}>
            <input type="hidden" name="fieldPresetKey" value={key} />
            <button
              type="submit"
              className="w-full rounded-md border border-rf-border bg-rf-panel p-5 text-left transition-colors hover:border-rf-violetSoft hover:bg-rf-surface"
            >
              <span className="block text-lg font-semibold text-rf-white">{preset.label}</span>
              <span className="mt-2 block text-sm text-rf-muted">
                {preset.categories.join(", ")}
              </span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement the onboarding page**

Create `src/app/onboarding/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { OnboardingPicker } from "@/components/OnboardingPicker";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

import { chooseField } from "./actions";

export default async function OnboardingPage() {
  const currentUser = await requireCurrentUser();
  const profile = await prisma.researchProfile.findUnique({ where: { userId: currentUser.id } });

  if (profile) {
    redirect(`/inbox/${currentUser.id}`);
  }

  return <OnboardingPicker chooseAction={chooseField} />;
}
```

- [ ] **Step 6: Update the home page to route by profile presence**

Replace `src/app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export default async function HomePage() {
  const currentUser = await requireCurrentUser();
  const profile = await prisma.researchProfile.findUnique({ where: { userId: currentUser.id } });

  if (!profile) {
    redirect("/onboarding");
  }

  redirect(`/inbox/${currentUser.id}`);
}
```

- [ ] **Step 7: Update the legacy home test in app-page-auth.test.ts**

In `tests/app-page-auth.test.ts`, replace the first test ("redirects the signed-in current user from root to their own inbox") with one that reflects the new profile-presence routing:

```ts
  it("redirects a user with a profile from root to their own inbox", async () => {
    const { default: HomePage } = await import("@/app/page");

    mocked.requireCurrentUser.mockResolvedValue({ id: "current-user" });
    mocked.prisma.researchProfile.findUnique.mockResolvedValue({ userId: "current-user" });

    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/inbox/current-user");
    expect(mocked.ensureProfileForUser).not.toHaveBeenCalled();
  });
```

The hoisted mock already includes `prisma.researchProfile.findUnique` and `ensureProfileForUser`, so no new mock wiring is required.

- [ ] **Step 8: Run the tests**

Run: `npm test -- tests/onboarding.test.ts tests/app-page-auth.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/onboarding src/components/OnboardingPicker.tsx src/app/page.tsx tests/onboarding.test.ts tests/app-page-auth.test.ts
git commit -m "feat: first-run field onboarding picker"
```

---

## Task 13: Inbox-date listing helper

**Files:**
- Modify: `src/lib/jobs/inbox-generation.ts`
- Create: `tests/inbox-dates.test.ts`

- [ ] **Step 1: Write a failing test**

Create `tests/inbox-dates.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

afterEach(() => {
  mocked.prisma = null;
});

async function seedCompletedInbox(client: PrismaClient, userId: string, inboxDate: string) {
  const batch = await client.candidateBatch.create({
    data: {
      userId,
      inboxDate,
      source: `arxiv-${inboxDate}`,
      query: "cat:cs.AI",
      status: "completed",
      completedAt: new Date()
    }
  });
  await client.inboxGenerationJob.create({
    data: {
      userId,
      candidateBatchId: batch.id,
      inboxDate,
      status: "completed",
      inputJson: "{}",
      completedAt: new Date()
    }
  });
}

describe("listInboxDatesForUser", () => {
  it("returns distinct inbox dates newest-first", async () => {
    const { listInboxDatesForUser } = await import("@/lib/jobs/inbox-generation");
    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({ data: { email: "dates@example.com" } });
      await seedCompletedInbox(client, user.id, "2026-06-23");
      await seedCompletedInbox(client, user.id, "2026-06-25");
      await seedCompletedInbox(client, user.id, "2026-06-24");

      expect(await listInboxDatesForUser(user.id)).toEqual([
        "2026-06-25",
        "2026-06-24",
        "2026-06-23"
      ]);
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/inbox-dates.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — `listInboxDatesForUser` is not exported.

- [ ] **Step 3: Add the helper**

Append to `src/lib/jobs/inbox-generation.ts`:

```ts
export async function listInboxDatesForUser(userId: string): Promise<string[]> {
  const [ideaDates, jobDates] = await Promise.all([
    prisma.generatedIdea.findMany({
      where: { userId },
      distinct: ["inboxDate"],
      select: { inboxDate: true }
    }),
    prisma.inboxGenerationJob.findMany({
      where: { userId },
      distinct: ["inboxDate"],
      select: { inboxDate: true }
    })
  ]);

  const dates = new Set<string>([
    ...ideaDates.map((row) => row.inboxDate),
    ...jobDates.map((row) => row.inboxDate)
  ]);

  return Array.from(dates).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/inbox-dates.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/inbox-generation.ts tests/inbox-dates.test.ts
git commit -m "feat: list inbox dates for a user"
```

---

## Task 14: Per-day inbox navigation UI

**Files:**
- Create: `src/components/InboxDateNav.tsx`
- Modify: `src/app/inbox/[userId]/page.tsx`
- Create: `tests/inbox-date-nav.test.tsx`

- [ ] **Step 1: Write the date-nav component test**

Create `tests/inbox-date-nav.test.tsx`:

```tsx
import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push })
}));

import { InboxDateNav } from "@/components/InboxDateNav";

describe("InboxDateNav", () => {
  it("lists available days and disables next on the newest day", () => {
    render(
      <InboxDateNav
        userId="u1"
        currentDate="2026-06-25"
        availableDates={["2026-06-25", "2026-06-24", "2026-06-23"]}
      />
    );

    expect(screen.getByLabelText("Inbox day")).toHaveValue("2026-06-25");
    expect(screen.getByRole("link", { name: "Newer day" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Older day" })).toHaveAttribute(
      "href",
      "/inbox/u1?date=2026-06-24"
    );
  });

  it("disables older on the oldest day", () => {
    render(
      <InboxDateNav
        userId="u1"
        currentDate="2026-06-23"
        availableDates={["2026-06-25", "2026-06-24", "2026-06-23"]}
      />
    );

    expect(screen.getByRole("link", { name: "Older day" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Newer day" })).toHaveAttribute(
      "href",
      "/inbox/u1?date=2026-06-24"
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/inbox-date-nav.test.tsx`
Expected: FAIL — `@/components/InboxDateNav` does not exist.

- [ ] **Step 3: Implement InboxDateNav**

Create `src/components/InboxDateNav.tsx`:

```tsx
"use client";

import React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";

type InboxDateNavProps = {
  userId: string;
  currentDate: string;
  availableDates: string[];
};

function hrefForDate(userId: string, date: string): Route {
  return `/inbox/${userId}?date=${date}` as Route;
}

export function InboxDateNav({ userId, currentDate, availableDates }: InboxDateNavProps) {
  const router = useRouter();
  const index = availableDates.indexOf(currentDate);
  // availableDates is newest-first: "newer" is the previous index, "older" is the next index.
  const newerDate = index > 0 ? availableDates[index - 1] : null;
  const olderDate = index >= 0 && index < availableDates.length - 1 ? availableDates[index + 1] : null;

  const arrowBase =
    "rounded-md border border-rf-border px-3 py-2 text-sm font-medium text-rf-white transition-colors hover:bg-rf-surface aria-disabled:cursor-not-allowed aria-disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        aria-disabled={newerDate ? undefined : "true"}
        className={arrowBase}
        href={newerDate ? hrefForDate(userId, newerDate) : hrefForDate(userId, currentDate)}
        aria-label="Newer day"
      >
        ◀
      </Link>

      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-rf-muted">
        Inbox day
        <select
          aria-label="Inbox day"
          className="rounded-md border border-rf-border bg-rf-surface px-3 py-2 text-sm text-rf-white focus:border-rf-violetSoft focus:outline-none"
          value={currentDate}
          onChange={(event) => router.push(hrefForDate(userId, event.target.value))}
        >
          {availableDates.length === 0 ? <option value={currentDate}>{currentDate}</option> : null}
          {availableDates.map((date) => (
            <option key={date} value={date}>
              {date}
            </option>
          ))}
        </select>
      </label>

      <Link
        aria-disabled={olderDate ? undefined : "true"}
        className={arrowBase}
        href={olderDate ? hrefForDate(userId, olderDate) : hrefForDate(userId, currentDate)}
        aria-label="Older day"
      >
        ▶
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- tests/inbox-date-nav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rewrite the inbox page for date scoping + PageShell**

Replace `src/app/inbox/[userId]/page.tsx` with the version below. Changes from current: imports `PageShell`, `InboxDateNav`, `listInboxDatesForUser`; reads optional `searchParams.date`; resolves the day; renders the nav; wraps content in `PageShell`. The `groupIdeasByPaper`, parsing helpers, `StatusCard`, and `renderInboxStatus` functions are unchanged from the current file — keep them.

```tsx
import React, { type ComponentProps } from "react";
import { notFound } from "next/navigation";

import { InboxDateNav } from "@/components/InboxDateNav";
import { PageShell } from "@/components/PageShell";
import { PaperIdeaGroup } from "@/components/PaperIdeaGroup";
import { canViewUserResearch } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getGeneratedInboxState, listInboxDatesForUser } from "@/lib/jobs/inbox-generation";

type GeneratedInboxIdea = Awaited<ReturnType<typeof getGeneratedInboxState>>["ideas"][number];
type PaperGroup = {
  id: string;
  paper: ComponentProps<typeof PaperIdeaGroup>["paper"];
  ideas: ComponentProps<typeof PaperIdeaGroup>["ideas"];
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// KEEP the existing parseStringArray, parseScoreExplanations, groupIdeasByPaper,
// StatusCard, and renderInboxStatus functions exactly as they are in the current file.

export default async function InboxPage({
  params,
  searchParams
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<{ date?: string | string[] }>;
}) {
  const currentUser = await requireCurrentUser();
  const { userId } = await params;

  if (!canViewUserResearch({ currentUserId: currentUser.id, targetUserId: userId })) {
    notFound();
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    notFound();
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedDateRaw = resolvedSearchParams.date;
  const requestedDate = Array.isArray(requestedDateRaw) ? requestedDateRaw[0] : requestedDateRaw;

  const availableDates = await listInboxDatesForUser(userId);
  const inboxDate =
    requestedDate && availableDates.includes(requestedDate)
      ? requestedDate
      : availableDates[0] ?? todayIsoDate();

  const inboxState = await getGeneratedInboxState(userId, inboxDate);
  const paperGroups = groupIdeasByPaper(inboxState.ideas);
  const displayName = user.name?.trim() || "Researcher";

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="inbox"
    >
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-rf-muted">
              AI research inbox
            </p>
            <h1 className="text-3xl font-semibold text-rf-white">
              {displayName}&apos;s generated research inbox
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-rf-muted">
              Showing the inbox for {inboxDate}. Each day is its own set of papers and ideas.
            </p>
          </div>
          <InboxDateNav userId={userId} currentDate={inboxDate} availableDates={availableDates} />
        </header>

        {inboxState.status === "ready" && paperGroups.length > 0 ? (
          <div className="grid gap-4">
            {paperGroups.map((group) => (
              <PaperIdeaGroup
                key={group.id}
                currentUserId={currentUser.id}
                generatedForUserId={userId}
                paper={group.paper}
                ideas={group.ideas}
                enableDispatch
              />
            ))}
          </div>
        ) : (
          renderInboxStatus(inboxState.status, inboxDate)
        )}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 6: Run the inbox-related tests**

Run: `npm test -- tests/app-page-auth.test.ts tests/inbox-date-nav.test.tsx`
Expected: PASS. The "checks shared visibility" test still throws NEXT_NOT_FOUND before any date/shell logic runs.

- [ ] **Step 7: Commit**

```bash
git add src/components/InboxDateNav.tsx "src/app/inbox/[userId]/page.tsx" tests/inbox-date-nav.test.tsx
git commit -m "feat: per-day inbox navigation"
```

---

## Task 15: Cross-day candidate dedup

**Files:**
- Modify: `src/lib/sources/arxiv-candidates.ts`
- Create: `tests/arxiv-candidates-dedup.test.ts`

- [ ] **Step 1: Write a failing dedup test**

Create `tests/arxiv-candidates-dedup.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  fetchArxivPapers: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

vi.mock("@/lib/arxiv/client", () => ({
  fetchArxivPapers: mocked.fetchArxivPapers
}));

afterEach(() => {
  mocked.prisma = null;
  vi.clearAllMocks();
});

function paper(arxivId: string) {
  return {
    arxivId,
    title: `Title ${arxivId}`,
    abstract: `Abstract ${arxivId}`,
    url: `https://arxiv.org/abs/${arxivId}`,
    publishedAt: new Date("2026-06-25T00:00:00.000Z"),
    updatedAt: new Date("2026-06-25T00:00:00.000Z"),
    authors: ["A. Author"],
    categories: ["cs.AI"]
  };
}

describe("createArxivCandidateBatchForUser cross-day dedup", () => {
  it("excludes papers the user already saw in an earlier batch", async () => {
    const { createArxivCandidateBatchForUser } = await import("@/lib/sources/arxiv-candidates");

    await withPostgresTestDatabase(async (client) => {
      mocked.prisma = client;
      const user = await client.user.create({
        data: {
          email: "dedup@example.com",
          profile: {
            create: {
              interestsJson: "[]",
              constraintsJson: "[]",
              preferredOutputsJson: "[]",
              rankingWeightsJson: "{}",
              arxivQuery: "cat:cs.AI"
            }
          }
        }
      });

      // Day 1: paper X is seen.
      const day1Batch = await client.candidateBatch.create({
        data: {
          userId: user.id,
          inboxDate: "2026-06-24",
          source: "arxiv",
          query: "cat:cs.AI",
          status: "completed",
          completedAt: new Date()
        }
      });
      await client.candidatePaper.create({
        data: {
          batchId: day1Batch.id,
          arxivId: "2606.0001",
          title: "Title X",
          abstract: "Abstract X",
          url: "https://arxiv.org/abs/2606.0001",
          publishedAt: new Date("2026-06-24T00:00:00.000Z"),
          authorsJson: "[]",
          categoriesJson: "[]",
          rawJson: "{}"
        }
      });

      // Day 2: arXiv returns X (already seen) and Y (new).
      mocked.fetchArxivPapers.mockResolvedValue([paper("2606.0001"), paper("2606.0002")]);

      const day2 = await createArxivCandidateBatchForUser(user.id, "2026-06-25");
      const ids = day2.candidates.map((candidate) => candidate.arxivId).sort();

      expect(ids).toEqual(["2606.0002"]);
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/arxiv-candidates-dedup.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: FAIL — both X and Y are stored (no cross-day dedup yet).

- [ ] **Step 3: Add the cross-day filter**

In `src/lib/sources/arxiv-candidates.ts`, replace the `papers` assignment (lines 17-19) with a version that also excludes previously-seen IDs:

```ts
  const seenCandidates = await prisma.candidatePaper.findMany({
    where: { batch: { userId } },
    select: { arxivId: true }
  });
  const seenArxivIds = new Set(seenCandidates.map((candidate) => candidate.arxivId));

  const papers = dedupePapersByArxivId(
    await fetchArxivPapers(profile.arxivQuery, profile.maxPapersScreened)
  ).filter((paper) => !seenArxivIds.has(paper.arxivId));
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- tests/arxiv-candidates-dedup.test.ts --no-file-parallelism --testTimeout 60000
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sources/arxiv-candidates.ts tests/arxiv-candidates-dedup.test.ts
git commit -m "feat: never re-surface previously seen arxiv papers"
```

---

## Task 16: Remove legacy tokens + lock the regression

**Files:**
- Modify: `tailwind.config.ts`
- Create: `tests/no-legacy-colors.test.ts`

> Do this only after Tasks 2–15; by now nothing under `src/` should reference the legacy tokens or raw light-palette classes.

- [ ] **Step 1: Write the guard test**

Create `tests/no-legacy-colors.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the guard test and fix any offenders**

Run: `npm test -- tests/no-legacy-colors.test.ts`
Expected: PASS. If it lists offenders, recolor each to the rf token equivalent (`slate→rf-muted`/`rf-border`/`rf-surface`, `white→rf-white`/`rf-panel`, status colors→`rf-success`/`rf-warning`/`rf-danger`) and re-run until clean.

- [ ] **Step 3: Remove legacy tokens from Tailwind**

In `tailwind.config.ts`, delete the `ink`, `paper`, `line`, and `accent` keys so only the `rf` object remains under `colors`:

```ts
  theme: {
    extend: {
      colors: {
        rf: {
          black: "#050507",
          panel: "#09080d",
          surface: "#0d0b12",
          border: "#2f293d",
          violet: "#651fff",
          violetSoft: "#7c4dff",
          white: "#f8f7ff",
          muted: "#aaa3bc",
          success: "#34d399",
          warning: "#fbbf24",
          danger: "#fb7185"
        }
      }
    }
  },
```

- [ ] **Step 4: Build to confirm no missing classes**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts tests/no-legacy-colors.test.ts
git commit -m "chore: remove legacy color tokens and lock the rf palette"
```

---

## Task 17: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint, type-check, build**

Run:
```powershell
npm run lint
npx tsc --noEmit --pretty false
npm run build
```
Expected: all exit 0. Pre-existing Next/Auth/Prisma warnings noted in the handoff are acceptable if unchanged.

- [ ] **Step 2: Full test suite with Postgres**

Run:
```powershell
$env:TEST_DATABASE_URL='postgresql://researchfinder:researchfinder@localhost:5432/researchfinder?schema=test'
npm test -- --no-file-parallelism --testTimeout 60000
```
Expected: all tests pass except the one pre-existing intentional skip noted in the handoff.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run `npm run dev`, sign in as a fresh user (no profile) → expect redirect to `/onboarding`; pick a field → land on the dark inbox; open `/profiles/<id>` and change the field preset → query/keywords repopulate; open `/dispatch/...`, `/jobs/...`, `/workers` → all dark, no light flashes; use the inbox day dropdown + arrows → each day shows only its own papers.

- [ ] **Step 4: Commit any verification fixups**

```bash
git add -A
git commit -m "test: verify UI compliance, field chooser, and per-day inbox"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 → Tasks 1, 16. Section 2 → Tasks 2, 4–8, 14. Section 3 → Tasks 9, 10, 11, 12. Section 4 → Tasks 13, 14, 15. Sections 5–6 → status-styles module (Task 1), per-task tests, guard test (Task 16).
- **Sequencing:** legacy tokens are removed only after every migration (Task 16), so intermediate builds stay green (unknown Tailwind classes render as no-ops, never build errors).
- **Type consistency:** `WorkerStatus` stays exported from `WorkerStatusPanel` and is imported by `status.ts`/`PageShell`; `ScoreToneKey`/`SignalStatusKey` come from `status-styles`; `ProfileUpdateData.interests` is optional and threaded from the action.
- **Known test touch-points:** `score-pill`, `signal-panel`, `profile-form`, `profile-presets`, `app-page-auth`, `app-shell`, `worker-setup-page` are updated where they assert old colors or need the worker-status mock.
