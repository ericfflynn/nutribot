# Agent Guide

Guidance for coding agents working in this repository. See [README.md](README.md) for product overview and project map.

## Project

NutriBot is a private, single-user (Eric) health and macro tracker: Next.js App Router, React, TypeScript, server actions. Meals and workouts are logged by chatting with Claude (the chat brain), reviewed as draft cards, then saved to Supabase Postgres. `/` (Today, any day via `?date=`): a day strip with sleep / recovery / strain dots, the check-in (the morning brief and call until 5 pm, then the evening quick replies; each goes away once answered), the Sleep / Recovery / Strain score card (scored in `lib/health/scores.ts` with formulas, calibration and limitations in [docs/scores.md](docs/scores.md), which must be updated whenever the scoring changes; tapping Sleep, Recovery or Strain opens its 7-day trends, and a sick line shows while ill), the Nutrition card with macro bars and water (tapping its title opens the week: calories as bars, protein as a line, each against its goal), a timeline of the day (meals open to edit or delete), and goals (`app/page.tsx`, `app/score-summary.tsx`, `app/body-ui.tsx`, `app/nutrition-toggle.tsx`, `app/today-checkin.tsx`); `/chat` is the chat thread (`?prompt=` prefills the composer). The **body state** ([docs/body-state.md](docs/body-state.md), `lib/body-state/`) is the core model: one daily picture of body and mind in domains (physical, mental, lifestyle), areas and signals, built by code from every source; the chat reads it through `get_body_state`. Read the spec before changing Home, Training, the chat or illness. Illness ([docs/illness.md](docs/illness.md)) is spotted from the watch (resting HR, sleep temperature, HRV, breathing against a personal baseline, `lib/health/illness.ts`), logged through chat as sick days, shown on Today and pushed once when likely, and makes Training's Next up rest. Journal entries and habits ([docs/journal-habits-plan.md](docs/journal-habits-plan.md)) are logged through chat and shown in Today's Check-in card and timeline; an 8 pm web-push reminder (`lib/reminders.ts`) reaches the Home Screen app. `/profile` only redirects to `/chat`. The UI is iPhone-first: iOS-style shell with a large title and bottom tab bar (`AppShell` in `app/shared-ui.tsx`). Users come from `APP_USERS`; the code still scopes everything by user name.

The chat brain ([docs/brain.md](docs/brain.md)) is the floating **Chat** button on every tab: `/api/brain` runs Claude through the Agent SDK on the owner's subscription, and its tools build meal and workout drafts that are saved only when the owner taps Save. Workouts are matched to Fitbit workouts in `lib/workouts.ts`. Read brain.md before changing the prompt, tools or draft shapes.

Direction: the app is chat-first. Chat tools build structured drafts that the owner saves, and Google Health data is loaded into Postgres. Read [docs/mvp-plan.md](docs/mvp-plan.md) before starting feature work.

## Commands

```bash
npm install
npm run dev      # local dev server, reads .env.local
npm run build    # production build; also runs the TypeScript check
npm run brain -- "chest and tris, hard"   # one chat turn in the terminal; writes nothing
npm run db:backup   # replace the local database backup in backups/
```

`npm test` runs the unit tests in `tests/` (Node's test runner with tsx): workout dedupe, habit edits and frequency, reminders, journal tags, training, illness, body state. Verify changes with `npm test` and `npm run build` (never while `npm run dev` is running: both write `.next`), then exercise the affected page against the dev server.

**Feedback queue.** The owner tells the chat about bugs and ideas for the app; they're saved to `app_feedback`. At the start of a dev pass, run `npm run feedback` to see open items, and mark each one `-- --done <id> "what changed"` (or `--drop`) once it's handled.

Other scripts: `npm run body:states` (rebuild stored body states, a dry run; `-- --apply` writes, `-- --from YYYY-MM-DD` limits it), `npm run workouts:dedupe` (dry run; `-- --apply` writes), `npm run demo:seed` (fictional data into a **local** database only; [docs/demo.md](docs/demo.md)).

## Environment

- Local config lives in `.env.local` (gitignored). `.env.example` lists the variables.
- Never print, log, or commit secret values. To check whether a variable is set, read its name, not its value.
- `DATABASE_URL` points at the **production** Supabase database. Local development uses real data.
- `CLAUDE_CODE_OAUTH_TOKEN` signs the chat brain in to the owner's Claude subscription, locally and in Vercel (Production and Preview). It lasts about a year; renewal steps are in [docs/brain.md](docs/brain.md#running-in-production). Never set `ANTHROPIC_API_KEY`.

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
- `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` is set because `/api/brain` ships the ~260 MB Claude Code binary. `vercel inspect <url> --wait` waits for a build without polling.
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

## Backups

`npm run db:backup` dumps the database's `public` schema to `backups/nutribot.dump` (gitignored). There is one backup at a time; each run replaces it, but only after the new dump is complete and readable.

- **At the start of a session** that touches the database, check the backup's age (`ls -l backups/nutribot.dump`). If it is missing or more than 7 days old, run `npm run db:backup` and say so.
- **Before any database write or DDL** you've been approved to run, run `npm run db:backup` first, whatever its age.
- **Restore** only with the owner's approval; it overwrites production. Restore one table with `pg_restore --data-only --table=<name>`, or everything with `pg_restore --clean --if-exists --no-owner -d "$DB" backups/nutribot.dump`. Use the session pooler (port 5432) for `pg_restore`, as the backup script does for `pg_dump`.
- The dump holds real meal and health data. Never copy it into the repo, a doc or any external service.

## Health sync

- Google Health data lands in `health_records` (raw JSONB) and is read through the `health_daily` and `health_workouts` views. Code is in `lib/health/`. `health_workouts` has one row per physical workout: duplicate watch recordings are folded via `health_workout_merges`, rebuilt after every exercise sync ([docs/workout-dedupe.md](docs/workout-dedupe.md)); `health_workout_records` shows every raw recording.
- Runs on six daily Vercel Cron jobs (`vercel.json` → `/api/cron/health-sync`, guarded by `CRON_SECRET`): a full month-replacing run at 13:00 UTC (9 AM Eastern in summer, 8 AM in winter) and five `?mode=recent` runs that upsert the last 3 days. The Hobby plan allows each cron job once a day, so more frequent syncs mean more entries, not a tighter schedule. Locally: `npm run health:sync` (`--recent` for a light run). Opening the app (or bringing it back to the foreground) also runs the light sync for the Fitbit owner when no sync started in the last 15 minutes (`autoSyncHealthAction`, `HealthAutoSync` in `app/refresh-button.tsx`), showing "Syncing" in the title bar.
- 24 more daily jobs, one per UTC hour, hit `/api/cron/reminders`; each run sends the reminders due in that local hour (rows in `reminders`, edited on the Habits tab; [docs/journal-habits-plan.md](docs/journal-habits-plan.md#reminders)). Hobby cron fires anywhere within its hour. `reminder_sends` records each reminder's send per day. Push needs `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, and only works over HTTPS, so test reminders on production or a preview, not the LAN dev server.
- Every run is logged in `health_sync_runs` (scope, status, records, failed types). Check there first when data looks stale.
- If runs fail with `invalid_grant`, the Google refresh token was revoked: run `npm run health:auth`, then update `GOOGLE_REFRESH_TOKEN` in Vercel (`vercel env add GOOGLE_REFRESH_TOKEN production --sensitive`).

## Guidelines

- **Decisions** the owner settles go in [docs/decisions.md](docs/decisions.md) (newest first: what, why, instead of). A change to the body state's stored shape needs a new `SCHEMA_VERSION`, an upgrade function and an entry in the spec's Schema versions table ([docs/body-state.md](docs/body-state.md#schema-versions)).

- **Database writes need the owner's approval.** Read-only queries are fine. Ask before any `insert`, `update`, `delete`, or DDL. Production is the only live copy of the data, and the only backup is the local dump (see Backups). There is no migration runner.
- **Schema changes:** update `supabase/schema.sql` (idempotent `create ... if not exists`) and show the SQL before running it.
- **Private data:** meal and health records belong to real people. Don't paste rows into commits, docs or PRs; use counts or synthetic examples. The README screenshots in `docs/screenshots/` show the fictional `demo` user (seeded with `npm run demo:seed -- --main`, see [docs/demo.md](docs/demo.md)); never replace them with the owner's real data.
- **Deploys and pushes are outward-facing.** Confirm before pushing to `master`, running `vercel deploy --prod`, or changing Vercel env vars.
- **Database access** goes through `pg` with `DATABASE_URL` (`getPool()` in `lib/supabase.ts`). There is no Supabase client.
- **Auth** is custom (`lib/auth.ts`): users and passwords come from env vars, sessions are HMAC-signed cookies. It is not Supabase Auth. Every server action and query must scope by the session user.
- **Dates** are local calendar dates in `APP_TIME_ZONE`; use the helpers in `lib/dates.ts` rather than `new Date()` math.
- Match the existing style: server actions in `app/actions.ts`, Zod for validating model output, plain CSS in `app/globals.css` using its tokens (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--accent`).
- Charts are hand-rolled SVG in `app/charts.tsx` (no chart library). Keep one y-axis per chart, a legend for two or more series, and missing days as gaps, never zeros.
- For UI changes, run `npm run dev` and let the owner check it on their phone rather than building screenshot tooling.
- Work on a branch; `master` is the production branch.

## Shell gotcha

The owner's shell is zsh, where `path` is tied to `PATH`. Don't use `path` as a loop or variable name in shell commands; it wipes `PATH` for the rest of the command.
