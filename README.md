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

The app uses Google Auth through Auth.js. Configure `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `ALLOWED_GOOGLE_EMAILS` in `.env` before signing in.

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

The values in `.env.example` are development-only. Set deployment-specific `CRON_SECRET`,
Google OAuth credentials, and an `ALLOWED_GOOGLE_EMAILS` allowlist before exposing the app.

## Tests

```powershell
npm test
```

## Product Specs and Plans

- [Research scout cloud product design](docs/superpowers/specs/2026-06-22-research-scout-cloud-product-design.md)
- [Research Finder inbox-to-gate implementation plan](docs/superpowers/plans/2026-06-22-research-finder-inbox-to-gate.md)
