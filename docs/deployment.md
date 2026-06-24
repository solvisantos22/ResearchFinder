# ResearchFinder Deployment

## Required Services

- Next.js hosting
- Postgres database
- Google OAuth client
- Hosted cron that calls `POST /api/cron/candidates`

The current V2 candidate cron creates arXiv candidate batches and inbox generation jobs for users with profiles. The repo also includes `POST /api/cron/ingest`, which builds the earlier daily inbox directly and uses the same `CRON_SECRET` bearer authorization.

## Environment Variables

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ALLOWED_GOOGLE_EMAILS`
- `CRON_SECRET`

Set `NEXTAUTH_URL` to the deployed application URL. `ALLOWED_GOOGLE_EMAILS` is a comma-separated allowlist; only those Google accounts can sign in. If the hosting platform does not forward the public host and protocol headers correctly, set `APP_URL` or `NEXT_PUBLIC_APP_URL` to the deployed application URL so the `/workers` setup command uses the hosted origin.

## Database

Use Prisma migrations for deployed databases:

```powershell
npm run db:deploy
```

Use migration development only against a development database:

```powershell
npm run db:migrate
```

## Cron Setup

Configure the hosted scheduler to send:

```text
POST /api/cron/candidates
Authorization: Bearer <CRON_SECRET>
```

`CRON_SECRET` must match the deployed environment variable. If you still need the older direct-ingest flow, schedule `POST /api/cron/ingest` with the same authorization header.

## Worker Setup

Sign in, open `/workers`, create a worker token, and run the displayed PowerShell installer once on the Windows machine that should run Codex jobs.

The `/workers` page registers an active worker and displays the one-time token setup command. The installed local worker runs a persistent polling loop, claims jobs from the hosted app, and drains queued jobs without waiting between successful completions. It uses Codex for inbox generation jobs and currently completes viability jobs with deterministic placeholder output. Set `RESEARCHFINDER_WORKER_POLL_MS` to tune the idle polling interval; the default is 30000 ms.
