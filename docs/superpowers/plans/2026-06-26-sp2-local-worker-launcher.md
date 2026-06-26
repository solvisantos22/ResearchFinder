# SP2 Local Worker Launcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single always-on local launcher that the dashboard steers via per-user lane toggles (Inbox/Research), spawning/killing the unchanged worker binary so workers never need manual install again.

**Architecture:** App stores desired lanes + a launcher credential; the launcher polls `GET /api/launcher/state` (~20s, doubles as heartbeat), provisions a rotating per-lane worker token via `POST /api/launcher/workers/[lane]/token`, and reconciles child worker processes to match. Launcher + workers run as the signed-in user (Codex needs per-user auth) — never a boot service.

**Tech Stack:** Next.js 15 App Router (route handlers, server actions), Prisma/Postgres, Zod, Vitest + Testing Library, tsx worker/launcher scripts, PowerShell installer. Reuses SP1 lanes (`src/lib/workers/lanes.ts`), worker-token primitives (`src/lib/jobs/worker-auth.ts`), and `ONLINE_WINDOW_MS` (`src/lib/workers/status.ts`).

**Conventions to follow:** Mirror existing siblings exactly — `src/lib/auth/worker-token.ts`, `src/lib/jobs/worker-registration.ts`, `src/app/api/workers/claim/route.ts`, `tests/research-worker-routes.test.ts` (Postgres route tests), `scripts/researchfinder-worker.ts` + `tests/researchfinder-worker.test.ts`, `scripts/install-worker.ps1` + `tests/install-worker.test.ts`. Postgres tests run via `withPostgresTestDatabase` (see `tests/helpers/postgres.ts`); run them with `TEST_DATABASE_URL` on port 5432 and `--no-file-parallelism --testTimeout 60000`.

---

## Task 1: Data model — launcher tables + desired state

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260626190000_local_launcher/migration.sql`
- Test: `tests/launcher-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/launcher-schema.test.ts
import { describe, expect, it } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";

describe("launcher schema", () => {
  it("persists a LauncherRegistration, WorkerLaneDesiredState, and launcher-managed worker", async () => {
    await withPostgresTestDatabase(async (db) => {
      const user = await db.user.create({ data: { email: "launcher@example.com" } });

      const launcher = await db.launcherRegistration.create({
        data: { userId: user.id, label: "ResearchFinder Launcher", tokenHash: "hash", status: "active" }
      });
      expect(launcher.status).toBe("active");
      expect(launcher.lastSeenAt).toBeNull();

      const desired = await db.workerLaneDesiredState.create({
        data: { userId: user.id, inboxEnabled: true }
      });
      expect(desired.inboxEnabled).toBe(true);
      expect(desired.researchEnabled).toBe(false);

      const worker = await db.workerRegistration.create({
        data: { userId: user.id, label: "Launcher Inbox worker", tokenHash: "wh", status: "active", lane: "inbox", launcherManaged: true }
      });
      expect(worker.launcherManaged).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `TEST_DATABASE_URL=... npx vitest run tests/launcher-schema.test.ts --no-file-parallelism --testTimeout 60000` → FAIL (`launcherRegistration`/`workerLaneDesiredState` undefined on client).

- [ ] **Step 3: Add the models + column.** In `prisma/schema.prisma` add:

```prisma
model LauncherRegistration {
  id         String    @id @default(cuid())
  userId     String
  label      String
  tokenHash  String
  status     String    @default("active")
  lastSeenAt DateTime?
  createdAt  DateTime  @default(now())
  revokedAt  DateTime?
  user       User      @relation(fields: [userId], references: [id])

  @@index([userId])
}

model WorkerLaneDesiredState {
  userId          String   @id
  inboxEnabled    Boolean  @default(false)
  researchEnabled Boolean  @default(false)
  updatedAt       DateTime @updatedAt
  user            User     @relation(fields: [userId], references: [id])
}
```

Add `launcherManaged Boolean @default(false)` to `model WorkerRegistration` (next to `lane`). Add back-relations to `model User`:

```prisma
  launcherRegistrations  LauncherRegistration[]
  workerLaneDesiredState WorkerLaneDesiredState?
```

- [ ] **Step 4: Create the migration SQL** (`prisma/migrations/20260626190000_local_launcher/migration.sql`). Mirror the column types Prisma uses elsewhere in this repo (cuid `TEXT`, `BOOLEAN NOT NULL DEFAULT false`, `TIMESTAMP(3)`). No BOM (see the `55ee5b8` fix). Suggested:

```sql
CREATE TABLE "LauncherRegistration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "LauncherRegistration_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LauncherRegistration_userId_idx" ON "LauncherRegistration"("userId");
ALTER TABLE "LauncherRegistration" ADD CONSTRAINT "LauncherRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WorkerLaneDesiredState" (
    "userId" TEXT NOT NULL,
    "inboxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "researchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerLaneDesiredState_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "WorkerLaneDesiredState" ADD CONSTRAINT "WorkerLaneDesiredState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkerRegistration" ADD COLUMN "launcherManaged" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 5: Regenerate the client** — `npx prisma generate`. (Postgres tests use `db push` from the schema, so they pick the models up directly.)

- [ ] **Step 6: Run the test to verify it passes** — same command as Step 2 → PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260626190000_local_launcher tests/launcher-schema.test.ts
git commit -m "feat: add launcher registration, desired-state, and launcher-managed worker schema"
```

---

## Task 2: Domain constant for launcher lanes

**Files:**
- Modify: `src/lib/v2/domain.ts`
- Test: `tests/launcher-domain.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/launcher-domain.test.ts
import { describe, expect, it } from "vitest";
import { LAUNCHER_LANES } from "@/lib/v2/domain";

describe("LAUNCHER_LANES", () => {
  it("is exactly the two launcher-managed lanes in priority order", () => {
    expect(LAUNCHER_LANES).toEqual(["inbox", "research"]);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`LAUNCHER_LANES` undefined).

- [ ] **Step 3: Implement.** In `src/lib/v2/domain.ts`, after `WORKER_LANES`:

```ts
// The lanes the local launcher manages (one worker each). A subset of WORKER_LANES;
// "both" is intentionally excluded — running inbox + research covers it.
export const LAUNCHER_LANES = ["inbox", "research"] as const;
export type LauncherLane = (typeof LAUNCHER_LANES)[number];
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat: add LAUNCHER_LANES domain constant"`

---

## Task 3: Launcher credential — registration + token auth

**Files:**
- Create: `src/lib/jobs/launcher-registration.ts`
- Create: `src/lib/auth/launcher-token.ts`
- Test: `tests/launcher-token.test.ts`

- [ ] **Step 1: Failing test** (Postgres-backed; mirror how `tests/research-worker-routes.test.ts` seeds users/workers).

```ts
// tests/launcher-token.test.ts
import { describe, expect, it } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";
import { registerLauncherForUser } from "@/lib/jobs/launcher-registration";
import { findAllowedLauncherByToken } from "@/lib/auth/launcher-token";

// NOTE: pass the test db client through the same mechanism research-worker-routes uses.
// findAllowedLauncherByToken/registerLauncherForUser import the shared prisma; these tests
// run against TEST_DATABASE_URL exactly like the worker-token paths.

describe("launcher token auth", () => {
  it("registers a launcher and resolves it by token (allowed email)", async () => {
    await withPostgresTestDatabase(async (db) => {
      const user = await db.user.create({ data: { email: "allowed@example.com" } });
      const { launcherId, token } = await registerLauncherForUser({ userId: user.id, label: "L" });

      const found = await findAllowedLauncherByToken(token);
      expect(found).toEqual({ id: launcherId, userId: user.id });
    });
  });

  it("rejects a revoked launcher and a disallowed email", async () => {
    await withPostgresTestDatabase(async (db) => {
      const blocked = await db.user.create({ data: { email: "blocked@notallowed.com" } });
      const { token: blockedToken } = await registerLauncherForUser({ userId: blocked.id, label: "L" });
      expect(await findAllowedLauncherByToken(blockedToken)).toBeNull();

      const ok = await db.user.create({ data: { email: "allowed2@example.com" } });
      const { launcherId, token } = await registerLauncherForUser({ userId: ok.id, label: "L" });
      await db.launcherRegistration.update({ where: { id: launcherId }, data: { revokedAt: new Date() } });
      expect(await findAllowedLauncherByToken(token)).toBeNull();
    });
  });
});
```

> The allowlist is controlled by `ALLOWED_GOOGLE_EMAILS` (`@example.com` is allowed in the existing tests' env). Match the env stubbing used by `tests/research-worker-routes.test.ts`.

- [ ] **Step 2: Run → FAIL** (modules don't exist).

- [ ] **Step 3: Implement `registerLauncherForUser`** (mirror `worker-registration.ts`):

```ts
// src/lib/jobs/launcher-registration.ts
import { prisma } from "@/lib/db";
import { createWorkerToken, hashWorkerToken } from "@/lib/jobs/worker-auth";

export async function registerLauncherForUser(input: { userId: string; label: string }) {
  const token = createWorkerToken();
  const tokenHash = await hashWorkerToken(token);
  const launcher = await prisma.launcherRegistration.create({
    data: { userId: input.userId, label: input.label, tokenHash, status: "active" },
    select: { id: true }
  });
  return { launcherId: launcher.id, token };
}
```

- [ ] **Step 4: Implement `findAllowedLauncherByToken`** (mirror `auth/worker-token.ts`):

```ts
// src/lib/auth/launcher-token.ts
import { isAllowedGoogleEmail } from "@/lib/auth/allowed-emails";
import { prisma } from "@/lib/db";
import { verifyWorkerToken } from "@/lib/jobs/worker-auth";

export async function findAllowedLauncherByToken(token: string) {
  const launchers = await prisma.launcherRegistration.findMany({
    where: { status: "active", revokedAt: null },
    select: { id: true, userId: true, tokenHash: true, user: { select: { email: true } } }
  });
  for (const launcher of launchers) {
    if (await verifyWorkerToken(token, launcher.tokenHash)) {
      return isAllowedGoogleEmail(launcher.user.email) ? { id: launcher.id, userId: launcher.userId } : null;
    }
  }
  return null;
}
```

- [ ] **Step 5: Run → PASS.**

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: launcher registration and token auth"`

---

## Task 4: Desired-state + lane-token provisioning lib

**Files:**
- Create: `src/lib/launcher/desired-state.ts`
- Test: `tests/launcher-desired-state.test.ts`

- [ ] **Step 1: Failing test** (Postgres-backed):

```ts
// tests/launcher-desired-state.test.ts
import { describe, expect, it } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";
import { getDesiredLanes, setLaneDesired, provisionLaneWorkerToken } from "@/lib/launcher/desired-state";
import { verifyWorkerToken } from "@/lib/jobs/worker-auth";

describe("launcher desired state", () => {
  it("defaults to all-off and persists toggles", async () => {
    await withPostgresTestDatabase(async (db) => {
      const u = await db.user.create({ data: { email: "a@example.com" } });
      expect(await getDesiredLanes(u.id)).toEqual({ inbox: false, research: false });
      await setLaneDesired(u.id, "inbox", true);
      expect(await getDesiredLanes(u.id)).toEqual({ inbox: true, research: false });
    });
  });

  it("provisions one launcher-managed worker per lane and rotates its token", async () => {
    await withPostgresTestDatabase(async (db) => {
      const u = await db.user.create({ data: { email: "b@example.com" } });

      const first = await provisionLaneWorkerToken(u.id, "research");
      const second = await provisionLaneWorkerToken(u.id, "research");

      const workers = await db.workerRegistration.findMany({
        where: { userId: u.id, lane: "research", launcherManaged: true }
      });
      expect(workers).toHaveLength(1); // reused, not duplicated
      // token rotated: only the latest verifies
      expect(await verifyWorkerToken(second.token, workers[0].tokenHash)).toBe(true);
      expect(await verifyWorkerToken(first.token, workers[0].tokenHash)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**

```ts
// src/lib/launcher/desired-state.ts
import { prisma } from "@/lib/db";
import { createWorkerToken, hashWorkerToken } from "@/lib/jobs/worker-auth";
import type { LauncherLane } from "@/lib/v2/domain";

export async function getDesiredLanes(userId: string): Promise<{ inbox: boolean; research: boolean }> {
  const row = await prisma.workerLaneDesiredState.findUnique({ where: { userId } });
  return { inbox: row?.inboxEnabled ?? false, research: row?.researchEnabled ?? false };
}

export async function setLaneDesired(userId: string, lane: LauncherLane, enabled: boolean) {
  const field = lane === "inbox" ? "inboxEnabled" : "researchEnabled";
  await prisma.workerLaneDesiredState.upsert({
    where: { userId },
    update: { [field]: enabled },
    create: { userId, [field]: enabled }
  });
}

const LAUNCHER_WORKER_LABEL: Record<LauncherLane, string> = {
  inbox: "Launcher Inbox worker",
  research: "Launcher Research worker"
};

// Ensure exactly one launcher-managed worker registration per (user, lane), rotate its
// token, and return the fresh plaintext. Rotation invalidates any orphaned worker from a
// previous launcher run (it gets 401 on its next claim and exits).
export async function provisionLaneWorkerToken(userId: string, lane: LauncherLane): Promise<{ token: string }> {
  const token = createWorkerToken();
  const tokenHash = await hashWorkerToken(token);

  const existing = await prisma.workerRegistration.findFirst({
    where: { userId, lane, launcherManaged: true },
    select: { id: true }
  });

  if (existing) {
    await prisma.workerRegistration.update({
      where: { id: existing.id },
      data: { tokenHash, status: "active", revokedAt: null }
    });
  } else {
    await prisma.workerRegistration.create({
      data: { userId, lane, launcherManaged: true, label: LAUNCHER_WORKER_LABEL[lane], tokenHash, status: "active" }
    });
  }
  return { token };
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: launcher desired-state and lane-token provisioning"`

---

## Task 5: `GET /api/launcher/state` (desired lanes + heartbeat)

**Files:**
- Create: `src/app/api/launcher/state/route.ts`
- Test: `tests/launcher-state-route.test.ts`

- [ ] **Step 1: Failing test** (Postgres-backed route test, mirror `tests/research-worker-routes.test.ts`): 401 with no/bad bearer; with a valid launcher token returns `{ inbox, research }` and sets `lastSeenAt`.

```ts
// tests/launcher-state-route.test.ts  (sketch — mirror research-worker-routes setup/env)
import { describe, expect, it } from "vitest";
import { withPostgresTestDatabase } from "./helpers/postgres";
import { registerLauncherForUser } from "@/lib/jobs/launcher-registration";
import { setLaneDesired } from "@/lib/launcher/desired-state";

describe("GET /api/launcher/state", () => {
  it("401s without a valid bearer", async () => {
    const { GET } = await import("@/app/api/launcher/state/route");
    const res = await GET(new Request("https://x/api/launcher/state", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });

  it("returns desired lanes and updates lastSeenAt", async () => {
    await withPostgresTestDatabase(async (db) => {
      const u = await db.user.create({ data: { email: "c@example.com" } });
      const { launcherId, token } = await registerLauncherForUser({ userId: u.id, label: "L" });
      await setLaneDesired(u.id, "research", true);

      const { GET } = await import("@/app/api/launcher/state/route");
      const res = await GET(new Request("https://x/api/launcher/state", { headers: { authorization: `Bearer ${token}` } }));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ inbox: false, research: true });

      const launcher = await db.launcherRegistration.findUniqueOrThrow({ where: { id: launcherId } });
      expect(launcher.lastSeenAt).not.toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (mirror auth in `src/app/api/workers/claim/route.ts`):

```ts
// src/app/api/launcher/state/route.ts
import { NextResponse } from "next/server";
import { findAllowedLauncherByToken } from "@/lib/auth/launcher-token";
import { readBearerToken } from "@/lib/jobs/worker-auth";
import { prisma } from "@/lib/db";
import { getDesiredLanes } from "@/lib/launcher/desired-state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = readBearerToken(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const launcher = await findAllowedLauncherByToken(token);
  if (!launcher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.launcherRegistration.update({ where: { id: launcher.id }, data: { lastSeenAt: new Date() } });
  const desired = await getDesiredLanes(launcher.userId);
  return NextResponse.json(desired);
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: launcher state endpoint with heartbeat"`

---

## Task 6: `POST /api/launcher/workers/[lane]/token`

**Files:**
- Create: `src/app/api/launcher/workers/[lane]/token/route.ts`
- Test: `tests/launcher-token-route.test.ts`

- [ ] **Step 1: Failing test**: 401 without bearer; 400 for an invalid lane (e.g. `both` or `nope`); with a valid token + `inbox`/`research` returns `{ token: <string> }` and creates exactly one launcher-managed worker for that lane.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (Next 15 async params — mirror `src/app/api/workers/jobs/[jobId]/complete/route.ts`'s `params: Promise<...>`):

```ts
// src/app/api/launcher/workers/[lane]/token/route.ts
import { NextResponse } from "next/server";
import { findAllowedLauncherByToken } from "@/lib/auth/launcher-token";
import { readBearerToken } from "@/lib/jobs/worker-auth";
import { provisionLaneWorkerToken } from "@/lib/launcher/desired-state";
import { LAUNCHER_LANES, type LauncherLane } from "@/lib/v2/domain";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ lane: string }> }) {
  const token = readBearerToken(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const launcher = await findAllowedLauncherByToken(token);
  if (!launcher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { lane } = await params;
  if (!(LAUNCHER_LANES as readonly string[]).includes(lane)) {
    return NextResponse.json({ error: "Unknown launcher lane" }, { status: 400 });
  }

  const provisioned = await provisionLaneWorkerToken(launcher.userId, lane as LauncherLane);
  return NextResponse.json({ token: provisioned.token });
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: launcher lane-token provisioning endpoint"`

---

## Task 7: Reconcile engine (pure)

**Files:**
- Create: `src/lib/launcher/reconcile.ts`
- Test: `tests/launcher-reconcile.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/launcher-reconcile.test.ts
import { describe, expect, it } from "vitest";
import { computeReconcilePlan } from "@/lib/launcher/reconcile";

describe("computeReconcilePlan", () => {
  it("spawns enabled lanes that are not running", () => {
    expect(computeReconcilePlan({ inbox: true, research: false }, [])).toEqual({ toSpawn: ["inbox"], toKill: [] });
  });
  it("kills running lanes that are no longer desired", () => {
    expect(computeReconcilePlan({ inbox: false, research: false }, ["inbox", "research"])).toEqual({ toSpawn: [], toKill: ["inbox", "research"] });
  });
  it("is a no-op when running matches desired", () => {
    expect(computeReconcilePlan({ inbox: true, research: true }, ["inbox", "research"])).toEqual({ toSpawn: [], toKill: [] });
  });
  it("spawns a lane that is desired but whose process has died (not in running)", () => {
    expect(computeReconcilePlan({ inbox: true, research: true }, ["inbox"])).toEqual({ toSpawn: ["research"], toKill: [] });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**

```ts
// src/lib/launcher/reconcile.ts
import { LAUNCHER_LANES, type LauncherLane } from "@/lib/v2/domain";

export function computeReconcilePlan(
  desired: { inbox: boolean; research: boolean },
  runningLanes: LauncherLane[]
): { toSpawn: LauncherLane[]; toKill: LauncherLane[] } {
  const running = new Set(runningLanes);
  const toSpawn: LauncherLane[] = [];
  const toKill: LauncherLane[] = [];
  for (const lane of LAUNCHER_LANES) {
    const wanted = lane === "inbox" ? desired.inbox : desired.research;
    if (wanted && !running.has(lane)) toSpawn.push(lane);
    if (!wanted && running.has(lane)) toKill.push(lane);
  }
  return { toSpawn, toKill };
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: pure launcher reconcile engine"`

---

## Task 8: Launcher agent script

**Files:**
- Create: `scripts/researchfinder-launcher.ts`
- Test: `tests/researchfinder-launcher.test.ts`
- Modify: `package.json` (add `"launcher:local": "tsx scripts/researchfinder-launcher.ts"`)

**Design:** export `runResearchFinderLauncher(config, options)` mirroring `runResearchFinderWorker`. Options inject `fetchImpl`, `spawnWorker(lane, token) => Handle`, `killWorker(handle)`, `sleep`, `pollMs`, `maxIterations`, `shouldStop`. The loop: each iteration `GET state` (heartbeat), prune dead handles, `computeReconcilePlan`, for `toSpawn` call `POST .../[lane]/token` then `spawnWorker(lane, token)`, for `toKill` call `killWorker`. Keep a `Map<LauncherLane, Handle>`.

- [ ] **Step 1: Failing test** — inject `fetchImpl` returning `{ inbox: true, research: false }` for state and `{ token: "t" }` for the token POST; assert `spawnWorker` called once with `("inbox", "t")` after one iteration (`maxIterations: 1`), and that a second iteration with `{ inbox: false }` calls `killWorker`. Mirror `tests/researchfinder-worker.test.ts` (injected deps, `maxIterations`).

```ts
// tests/researchfinder-launcher.test.ts (sketch)
import { describe, expect, it, vi } from "vitest";
import { runResearchFinderLauncher } from "../scripts/researchfinder-launcher";

function fetchStub(states: Array<{ inbox: boolean; research: boolean }>) {
  let i = 0;
  return vi.fn(async (url: string) => {
    if (url.endsWith("/api/launcher/state")) return { ok: true, json: async () => states[Math.min(i++, states.length - 1)] };
    if (url.includes("/token")) return { ok: true, json: async () => ({ token: "t" }) };
    throw new Error(`unexpected ${url}`);
  });
}

describe("runResearchFinderLauncher", () => {
  it("spawns a desired lane and kills it when no longer desired", async () => {
    const spawnWorker = vi.fn(() => ({ id: "h" }));
    const killWorker = vi.fn();
    await runResearchFinderLauncher(
      { appUrl: "https://x", launcherToken: "L", codexCommand: "codex" },
      { fetchImpl: fetchStub([{ inbox: true, research: false }, { inbox: false, research: false }]), spawnWorker, killWorker, sleep: async () => {}, maxIterations: 2 }
    );
    expect(spawnWorker).toHaveBeenCalledWith("inbox", "t");
    expect(killWorker).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `scripts/researchfinder-launcher.ts`. Core skeleton (real child spawning lives in the default `spawnWorker`/`killWorker`, kept thin so the loop is testable):

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { computeReconcilePlan } from "@/lib/launcher/reconcile";
import { LAUNCHER_LANES, type LauncherLane } from "@/lib/v2/domain";

type LauncherConfig = { appUrl: string; launcherToken: string; codexCommand?: string };
type WorkerHandle = { lane: LauncherLane; child: ChildProcess; isAlive: () => boolean };

type Options = {
  fetchImpl?: typeof fetch;
  spawnWorker?: (lane: LauncherLane, workerToken: string) => WorkerHandle;
  killWorker?: (handle: WorkerHandle) => void;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxIterations?: number;
  shouldStop?: () => boolean;
};

const DEFAULT_POLL_MS = 20_000;
const norm = (u: string) => u.replace(/\/+$/, "");

export async function runResearchFinderLauncher(config: LauncherConfig, options: Options = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const spawnWorker = options.spawnWorker ?? defaultSpawnWorker(config);
  const killWorker = options.killWorker ?? ((h: WorkerHandle) => h.child.kill());
  const running = new Map<LauncherLane, WorkerHandle>();
  let iterations = 0;

  while (!options.shouldStop?.()) {
    try {
      // prune dead children
      for (const [lane, h] of [...running]) if (!h.isAlive()) running.delete(lane);

      const stateRes = await doFetch(`${norm(config.appUrl)}/api/launcher/state`, {
        headers: { authorization: `Bearer ${config.launcherToken}` }
      });
      if (!stateRes.ok) throw new Error(`launcher state failed: ${stateRes.status}`);
      const desired = (await stateRes.json()) as { inbox: boolean; research: boolean };

      const plan = computeReconcilePlan(desired, [...running.keys()]);
      for (const lane of plan.toKill) { const h = running.get(lane); if (h) { killWorker(h); running.delete(lane); } }
      for (const lane of plan.toSpawn) {
        const tokenRes = await doFetch(`${norm(config.appUrl)}/api/launcher/workers/${lane}/token`, {
          method: "POST", headers: { authorization: `Bearer ${config.launcherToken}` }
        });
        if (!tokenRes.ok) throw new Error(`token provision failed for ${lane}: ${tokenRes.status}`);
        const { token } = (await tokenRes.json()) as { token: string };
        running.set(lane, spawnWorker(lane, token));
      }
    } catch (error) {
      // Transient: log and keep running workers as-is (do not tear down on poll failure).
      console.error(error instanceof Error ? error.message : String(error));
    }

    iterations += 1;
    if (options.maxIterations !== undefined && iterations >= options.maxIterations) return;
    await sleep(pollMs);
  }
}

function defaultSpawnWorker(config: LauncherConfig) {
  return (lane: LauncherLane, workerToken: string): WorkerHandle => {
    const dir = mkdtempSync(join(tmpdir(), `rf-launcher-${lane}-`));
    const cfgPath = join(dir, ".worker.json");
    writeFileSync(cfgPath, JSON.stringify({ appUrl: config.appUrl, workerToken, codexCommand: config.codexCommand }), "utf8");
    const tsxPath = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const child = spawn(process.execPath, [tsxPath, "scripts/researchfinder-worker.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, RESEARCHFINDER_WORKER_CONFIG: cfgPath, RESEARCHFINDER_CODEX_COMMAND: config.codexCommand ?? "" },
      stdio: "inherit"
    });
    let alive = true;
    child.on("exit", () => { alive = false; });
    return { lane, child, isAlive: () => alive };
  };
}

export function loadLauncherConfig(): LauncherConfig {
  const path = process.env.RESEARCHFINDER_LAUNCHER_CONFIG ?? join(process.cwd(), ".launcher.json");
  return JSON.parse(readFileSync(path, "utf8")) as LauncherConfig;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResearchFinderLauncher(loadLauncherConfig()).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run → PASS.** Add `"launcher:local"` to `package.json` scripts.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: local launcher agent with reconcile loop"`

---

## Task 9: `install-launcher.ps1`

**Files:**
- Create: `scripts/install-launcher.ps1`
- Test: `tests/install-launcher.test.ts`

- [ ] **Step 1: Failing test** — mirror `tests/install-worker.test.ts`: read the script text and assert it (a) writes `.launcher.json` with `appUrl`/`workerToken`→`launcherToken`, (b) `Register-ScheduledTask` with a logon trigger, (c) runs `scripts/researchfinder-launcher.ts`, (d) task name `"ResearchFinder Launcher"`, (e) UTF8-no-BOM config write.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** by copying `scripts/install-worker.ps1` and adapting: params `-AppUrl -LauncherToken [-TaskName "ResearchFinder Launcher"]`; write `.launcher.json` (`appUrl`, `launcherToken`, `codexCommand`) instead of `.worker.json`; runner runs `scripts/researchfinder-launcher.ts`; set `RESEARCHFINDER_LAUNCHER_CONFIG`; single task with the same logon + `-StartWhenAvailable` + restart settings. Install dir `$env:LOCALAPPDATA\ResearchFinderLauncher`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: install-launcher.ps1 one-time launcher install"`

---

## Task 10: Dashboard — launcher panel + lane toggles

**Files:**
- Modify: `src/app/workers/actions.ts` (add `registerLauncher`, `setLaneDesiredAction`, `getLauncherOverview`)
- Modify: `src/app/workers/page.tsx` (render launcher panel)
- Create: `src/components/LauncherPanel.tsx` (status + install command + Inbox/Research toggles)
- Create: `src/lib/launcher/status.ts` (`resolveLauncherStatusForUser` reusing `ONLINE_WINDOW_MS`)
- Test: `tests/launcher-panel.test.tsx`, `tests/launcher-actions.test.ts`

- [ ] **Step 1: Failing tests** — (a) `setLaneDesiredAction` persists desired state for the current user (mock `requireCurrentUser`, Postgres-backed); (b) `LauncherPanel` renders "offline" + an install command when no launcher, renders the two toggles, and calls `setLaneDesiredAction` on toggle (mirror `tests/worker-setup-page.test.tsx` for render + action wiring).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
  - `src/lib/launcher/status.ts`: `resolveLauncherStatusForUser(userId)` → `"online" | "offline"` using the most-recent non-revoked `LauncherRegistration` and `ONLINE_WINDOW_MS` from `src/lib/workers/status.ts` (mirror `resolveWorkerStatusForUser`).
  - `src/app/workers/actions.ts`: `registerLauncher()` → `requireCurrentUser` + `registerLauncherForUser`, returns `{ token, installCommand }` where `installCommand` is the `install-launcher.ps1 -AppUrl <APP_URL> -LauncherToken <token>` string (mirror the worker `setupCommand`); `setLaneDesiredAction(lane, enabled)` → `requireCurrentUser` + `setLaneDesired`; `getLauncherOverview()` → `{ status, desired }`.
  - `src/components/LauncherPanel.tsx`: `"use client"`, shows status dot + (if no launcher) the one-time install command, and two controlled toggles bound to `setLaneDesiredAction`, with an "applies within ~20s" hint. Reuse `rf-*` Tailwind tokens.
  - `src/app/workers/page.tsx`: render `<LauncherPanel />` above the SP1 `WorkersOverviewLive`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: launcher dashboard panel and lane toggles"`

---

## Task 11: Full verification

- [ ] **Step 1:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 2:** `npx eslint` on all created/changed files → exit 0.
- [ ] **Step 3:** Full suite (clean DB): `TEST_DATABASE_URL=...:5432... npx vitest run --no-file-parallelism --testTimeout 60000` → all pass.
- [ ] **Step 4:** `npm run build` → compiles.
- [ ] **Step 5:** Final whole-branch review (subagent-driven final reviewer) over the full diff vs `main`.

---

## Self-review notes (author)

- **Spec coverage:** data model (T1), launcher lanes (T2), credential/auth (T3), desired-state + token rotation (T4), state endpoint+heartbeat (T5), lane-token endpoint (T6), reconcile engine (T7), agent (T8), installer (T9), dashboard (T10), verification (T11). All spec sections A–H mapped.
- **Type consistency:** `LauncherLane` = `"inbox"|"research"` used in domain (T2), desired-state (T4), reconcile (T7), agent (T8), route (T6). `getDesiredLanes` returns `{inbox, research}` consumed identically by the route (T5) and agent (T8). `provisionLaneWorkerToken` returns `{token}`; the route (T6) and agent (T8) read `.token`.
- **Open decisions resolved:** poll interval default = 20s (env-overridable later, not required); disabling a lane stops the process only (no revoke) — registration persists so SP1 cards keep history; revoke happens only via launcher revoke (future).
