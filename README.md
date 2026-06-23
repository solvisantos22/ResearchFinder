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

## Cron and Deployment

The hosted daily ingest entrypoint is:

```text
POST /api/cron/ingest
Authorization: Bearer <CRON_SECRET>
```

The values in `.env.example` are development-only. Set a deployment-specific `CRON_SECRET`
before exposing the cron route.

This milestone uses a lightweight private access boundary instead of a full auth provider. To
enable it, set `APP_ACCESS_TOKENS` to comma-separated `userId:token` pairs:

```text
APP_ACCESS_TOKENS="demo-solvi:secret-1,demo-collaborator:secret-2"
```

When this env var is unset or empty, local development behavior is unchanged. When it is set,
open a protected route with `?accessToken=<token>` once; the app maps the token to its user,
sets httpOnly cookies, strips the token from the URL, and gates `/inbox`, `/dispatch`, and
`/jobs` to that user. A full auth provider belongs in a later phase.

## Tests

```powershell
npm test
```

## Product Specs and Plans

- [Research scout cloud product design](docs/superpowers/specs/2026-06-22-research-scout-cloud-product-design.md)
- [Research Finder inbox-to-gate implementation plan](docs/superpowers/plans/2026-06-22-research-finder-inbox-to-gate.md)
