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
http://localhost:3000
```

Authentication is handled by Google sign-in through Auth.js. Configure
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_GOOGLE_EMAILS` in
`.env`; only accounts listed in `ALLOWED_GOOGLE_EMAILS` can sign in.

## Worker

After signing in, open `/workers` to register and connect a local worker. Run
the one-time PowerShell installer command shown on that page; it writes the
worker config in the install directory and sets up the connected worker runner.

For manual local development, `npm run worker:local` starts a polling worker
loop. It requires either a repo-local `.worker.json` file or
`RESEARCHFINDER_WORKER_CONFIG` pointing at a generated worker config. Use
`npm run worker:once` to claim and process a single job for debugging.

## Cron and Deployment

See [ResearchFinder deployment](docs/deployment.md) for hosted setup, required
services, environment variables, database migrations, cron, and worker setup.

The hosted V2 candidate cron entrypoint is:

```text
POST /api/cron/candidates
Authorization: Bearer <CRON_SECRET>
```

The older direct-ingest route remains available at `POST /api/cron/ingest`.

The values in `.env.example` are development-only. Set deployment-specific `CRON_SECRET`,
Google OAuth credentials, and an `ALLOWED_GOOGLE_EMAILS` allowlist before exposing the app.

## Tests

```powershell
npm test
```

## Product Specs and Plans

- [Research scout cloud product design](docs/superpowers/specs/2026-06-22-research-scout-cloud-product-design.md)
- [Research Finder inbox-to-gate implementation plan](docs/superpowers/plans/2026-06-22-research-finder-inbox-to-gate.md)
