# Nightly Candidate Fetch — Scheduler + Resilience

**Date:** 2026-06-26
**Status:** Approved (design confirmed in chat)
**Scope:** Small fix. Interlude before SP2 (worker local launcher) in the worker-harness-ops initiative.

## Problem

The nightly AI inbox depends on `POST /api/cron/candidates`, which fetches arXiv candidates and creates one `inbox_generation` job per allowed user. Two gaps caused "the fetch failed tonight / no ResearchFinder job":

1. **No scheduler exists.** There is no `vercel.json` cron and no GitHub Action. The endpoint has only ever been triggered by a manual `curl`, so on any night nobody runs it, nothing is created — and the worker (which only *consumes* jobs) sits idle with nothing to do. This is the root cause.
2. **No resilience on the arXiv fetch.** `fetchArxivPapers` (`src/lib/arxiv/client.ts`) does a single `fetch()` with no timeout and no retry. A transient network reject (`TypeError: fetch failed`) or a hang wastes the entire night, because the candidate batch is only persisted *after* the fetch succeeds.

The worker's own occasional `fetch failed` log line is unrelated — that is its claim loop briefly failing to reach the app, which self-heals on the next poll. It is not in scope.

## Design

### A. Scheduler — `vercel.json` (new, repo root)

```json
{
  "crons": [
    { "path": "/api/cron/candidates", "schedule": "0 5 * * *" }
  ]
}
```

Runs daily at **05:00 UTC** (= 05:00 in Iceland, UTC+0): the `inbox_generation` job is queued before morning, and the running worker generates the inbox in time. On Vercel Hobby a single daily cron is allowed; Vercel may fire it anywhere within the scheduled hour rather than the exact minute — acceptable here.

### B. GET handler — `src/app/api/cron/candidates/route.ts`

Vercel cron triggers a path with a **GET** request (not POST) and auto-attaches `Authorization: Bearer $CRON_SECRET` when the `CRON_SECRET` env var is set — which the route already validates via `isAuthorizedCronRequest`. So:

- Extract the existing handler body into a shared `runCandidateFetch(request)`.
- `export async function POST(request)` and `export async function GET(request)` both delegate to it (POST kept for the manual curl, GET for Vercel cron). Identical auth + behavior.
- Add `export const dynamic = "force-dynamic";` so the cron endpoint is never statically cached.

### C. Resilience — `src/lib/arxiv/client.ts`

Wrap the arXiv `fetch()` in a timeout + bounded retry:

- **Timeout:** `AbortController` aborting each attempt after `timeoutMs` (default **15000**).
- **Retry:** up to `attempts` tries (default **3**) with exponential backoff `backoffMs * 2^(n-1)` (default `backoffMs` **1000** → 0s, 1s, 2s waits).
- **Retry only transient failures:** a thrown `fetch()` rejection (network) or an abort/timeout is retried. An **HTTP error status is NOT retried** — a non-`ok` response still throws `arXiv fetch failed: <status> <statusText>` immediately (preserves current 503 behavior). Classifier: an error whose message starts with `arXiv fetch failed:` is non-retryable; anything else is retryable.
- Retry knobs are exposed on the existing `FetchArxivPapersOptions` as an optional `retry` override (defaults = production values) so tests can set `backoffMs: 0` and run instantly. Production callers pass nothing and get the defaults.

## Testing

- **`arxiv-client.test.ts`** (update + add):
  - Update the "sends the expected query" assertion to include `signal: expect.any(AbortSignal)`.
  - Update the 503 test to assert `fetch` was called **once** (no retry on HTTP status).
  - Add: retries after one transient `fetch()` reject, then succeeds (2 calls).
  - Add: throws after exhausting `attempts` on persistent rejects (N calls).
  - Add: aborts a hung request after `timeoutMs` and retries to success (stub honors `init.signal` abort).
- **`candidates-cron-route.test.ts`** (add): `GET` with a valid bearer creates jobs like `POST`; `GET` without/with a wrong bearer returns 401.
- **`vercel-cron.test.ts`** (new): parse `vercel.json` and assert the `/api/cron/candidates` cron exists with schedule `0 5 * * *`.

## Out of scope

- Worker claim-loop resilience (its transient `fetch failed` already self-heals).
- Any change to job priority, lanes, or the worker binary.
- SP2 (local launcher) — the next initiative item, unchanged by this.
