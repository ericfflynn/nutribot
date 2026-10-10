# Agent Guide

Guidance for coding agents working in this repository. See [README.md](README.md) for product overview and project map.

## Project

NutriBot is a private, single-user (Eric) health and macro tracker: Next.js App Router, React, TypeScript, server actions. Meals are entered in plain English, estimated by an OpenAI model in `lib/macro-parser.ts`, reviewed, then saved to Supabase Postgres. `/` (Today, any day via `?date=`) is the combined dashboard: Sleep / Recovery / Strain rings (scored in `lib/health/scores.ts`; formulas, calibration and limitations in [docs/scores.md](docs/scores.md), which must be updated whenever the scoring changes), nutrition and water, a timeline of the day and 7-day trends; `/profile` (Log) is the meal logger, history, and goals. The UI is iPhone-first: iOS-style shell with a large title and bottom tab bar (`AppShell` in `app/shared-ui.tsx`). Users come from `APP_USERS`; the code still scopes everything by user name.

Direction: the app is moving toward a chat-first interface where tool calls write structured records and Google Health data is loaded into Postgres. Read [docs/mvp-plan.md](docs/mvp-plan.md) before starting feature work. Don't rebuild the existing meal flow without being asked.

## Commands

```bash
npm install
npm run dev      # local dev server, reads .env.local
npm run build    # production build; also runs the TypeScript check
```

There is no test suite. Verify changes with `npm run build`, then exercise the affected page against the dev server.

## Environment

- Local config lives in `.env.local` (gitignored). `.env.example` lists the variables.
- Never print, log, or commit secret values. To check whether a variable is set, read its name, not its value.
- `DATABASE_URL` points at the **production** Supabase database. Local development uses real data.

## CLIs available

All of these are installed and authenticated on the owner's machine.

| CLI | Use it for |
| --- | --- |
| `vercel` | Deployments, env vars, logs. Repo is linked to project `nutribot`. |
| `supabase` | Project status, dashboard-level management. Project "Nutribot", ref `ddjdwftjeejkjvxvznwm`, us-east-1. |
| `psql` | Running SQL against the database. |
| `gh` | GitHub repo `ericfflynn/nutribot`: PRs, issues. |

### Vercel

- Production URL: https://nutribot-dusky.vercel.app (`nutribot.vercel.app` belongs to someone else).
- The project is Git-connected: pushing to `master` deploys production; other branches get preview deploys.
- `vercel deploy --prod` deploys the local working tree, including uncommitted files. Prefer deploying through Git.
- `vercel ls`, `vercel logs <url>`, `vercel inspect <url>` for status and debugging.
- `vercel env ls` lists variables. Secret values cannot be pulled back down; `vercel env pull` returns placeholders for them. Set values with `vercel env add NAME production`.
- `vercel link` and `vercel env pull` write to `.env.local` and `.gitignore`. Check `git diff` afterwards.

### Supabase

- `supabase projects list` shows project status. Free-tier projects pause after inactivity; status `INACTIVE` means the app will fail to connect.
- The repo is not `supabase link`ed and does not use Supabase migrations. The schema lives in `supabase/schema.sql`.

### psql

Connect without echoing the connection string:

```bash
DB="$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')"
psql "$DB" -c "select count(*) from macro_entries;"
```

`DATABASE_URL` uses the transaction pooler (port 6543), which works for ordinary queries but not for session features such as `LISTEN` or prepared statements across calls.

## Health sync

- Google Health data lands in `health_records` (raw JSONB) and is read through the `health_daily` and `health_workouts` views. Code is in `lib/health/`.
- Runs on six daily Vercel Cron jobs (`vercel.json` → `/api/cron/health-sync`, guarded by `CRON_SECRET`): a full month-replacing run at 11:00 UTC and five `?mode=recent` runs that upsert the last 3 days. The Hobby plan allows each cron job once a day, so more frequent syncs mean more entries, not a tighter schedule. Locally: `npm run health:sync` (`--recent` for a light run).
- Every run is logged in `health_sync_runs` (scope, status, records, failed types). Check there first when data looks stale.
- If runs fail with `invalid_grant`, the Google refresh token was revoked: run `npm run health:auth`, then update `GOOGLE_REFRESH_TOKEN` in Vercel (`vercel env add GOOGLE_REFRESH_TOKEN production --sensitive`).

## Guidelines

- **Database writes need the owner's approval.** Read-only queries are fine. Ask before any `insert`, `update`, `delete`, or DDL. This is the only copy of the data and there is no migration runner or backup process in the repo.
- **Schema changes:** update `supabase/schema.sql` (idempotent `create ... if not exists`) and show the SQL before running it.
- **Private data:** meal and health records belong to real people. Don't paste rows into commits, docs, PRs, or screenshots. Use counts or synthetic examples.
- **Deploys and pushes are outward-facing.** Confirm before pushing to `master`, running `vercel deploy --prod`, or changing Vercel env vars.
- **Database access** goes through `lib/supabase.ts`. It uses `pg` when `DATABASE_URL` is set, otherwise the Supabase service-role client. Keep both paths working, or remove one deliberately.
- **Auth** is custom (`lib/auth.ts`): users and passwords come from env vars, sessions are HMAC-signed cookies. It is not Supabase Auth. Every server action and query must scope by the session user.
- **Dates** are local calendar dates in `APP_TIME_ZONE`; use the helpers in `lib/dates.ts` rather than `new Date()` math.
- Match the existing style: server actions in `app/actions.ts`, Zod for validating model output, plain CSS in `app/globals.css` using its tokens (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--accent`).
- Charts are hand-rolled SVG in `app/charts.tsx` (no chart library). Keep one y-axis per chart, a legend for two or more series, and missing days as gaps, never zeros.
- For UI changes, run `npm run dev` and let the owner check it on their phone rather than building screenshot tooling.
- Work on a branch; `master` is the production branch.

## Shell gotcha

The owner's shell is zsh, where `path` is tied to `PATH`. Don't use `path` as a loop or variable name in shell commands; it wipes `PATH` for the rest of the command.
