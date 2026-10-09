# NutriBot

NutriBot is a private, single-user health app: plain-English meal logging with AI macro estimates, plus Fitbit data synced daily from Google Health.

Production: https://nutribot-dusky.vercel.app · Direction and roadmap: [docs/mvp-plan.md](docs/mvp-plan.md) · Agent guidelines: [AGENTS.md](AGENTS.md)

## Features

- **Today:** one iPhone-style page. Whoop-inspired dials for Sleep, Recovery and Activity (strain) up top, then nutrition (calories and macros vs goals), recovery details (sleep, HRV, resting heart rate vs the past week), and workouts ranked by intensity. A Refresh button pulls the latest Fitbit data on demand.
- **Scores** (`lib/health/scores.ts`, NutriBot's own estimates, not Whoop's formulas): Sleep is hours asleep vs an 8-hour need; Recovery (0-100%, green/yellow/red) compares today's HRV and resting heart rate with your 30-day baseline, plus sleep; Strain (0-21) weights heart-rate zone minutes by intensity, plus steps, for the day and for each workout.
- **Log:** plain-English meal logging with OpenAI macro estimates, a review step, corrections, manual edits and goals.
- Fitbit data synced from Google Health several times a day: activity totals, resting heart rate, HRV, sleep, SpO2, VO2 max and workout summaries.

## Product Flow

1. Enter a meal like `Greek yogurt with berries, honey, and granola`.
2. Review the generated estimate and item breakdown.
3. Add a correction or manually adjust totals if needed.
4. Save the meal to today or a selected previous day.
5. Track today against goals and compare against completed logged days.

## Screenshots

![Home dashboard](docs/screenshots/home-dashboard.png)

![Meal logging profile](docs/screenshots/profile-log.png)

## Stack

- Next.js App Router, TypeScript, React Server Actions
- OpenAI structured outputs for meal estimates
- Supabase Postgres (accessed server-side with `pg`)
- Google Health API for Fitbit data
- Vercel hosting and Vercel Cron

## Developer Setup

```bash
npm install
```

Create `.env.local` (see `.env.example`):

```bash
APP_USERS=Eric
APP_USER_PASSWORDS=Eric:your-password
AUTH_SECRET=your-long-random-cookie-signing-secret   # openssl rand -base64 32
APP_TIME_ZONE=America/New_York

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

DATABASE_URL=postgresql://postgres.your-project-ref:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Google Health sync
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...   # written by npm run health:auth
GOOGLE_HEALTH_USER=Eric
CRON_SECRET=...            # any long random string; Vercel Cron sends it
```

Create or update tables (idempotent):

```bash
psql "$DATABASE_URL" -f supabase/schema.sql
```

Run and build:

```bash
npm run dev
npm run build
```

## Fitbit health data

Data comes from the Google Health API and is stored Fitbit-only: Apple Health and other sources are dropped at ingest, and minute-level data is never downloaded.

| What | How it's stored |
| --- | --- |
| Steps, distance, active and total calories, active minutes, zone minutes | One daily total per day, from the API's `dailyRollUp` endpoint |
| Resting heart rate, HRV, SpO2, breathing rate, VO2 max, sleep temperature | One record per day |
| Sleep | One record per sleep session, including stage summaries |
| Workouts | One record per session: type, times, duration, calories, average heart rate, distance, steps, heart rate zones |

Raw payloads live in `health_records` (JSONB). Read them through two views:

- `health_daily`: one row per day with plain columns for activity, heart, sleep and other metrics.
- `health_workouts`: one row per workout, times in local time.

Full syncs replace whole months (the current month, plus the previous one early in a month) in a single transaction; recent syncs upsert the last 3 days by record key. Either way, reruns never create duplicates.

### Authorizing Google

```bash
npm run health:auth
```

Opens Google's consent page (three read-only scopes: activity and fitness, health metrics, sleep), then asks for the redirected URL and saves `GOOGLE_REFRESH_TOKEN` to `.env.local`. The OAuth app is published but unverified, so Google shows an "unverified app" warning: choose **Advanced → Go to NutriBot**. After re-authorizing, copy the token to Vercel:

```bash
vercel env add GOOGLE_REFRESH_TOKEN production --sensitive
```

### Syncing

- **Scheduled:** six Vercel Cron jobs in `vercel.json` call `/api/cron/health-sync`, each once a day (the Hobby plan limit), ±59 minutes:
  - 11:00 UTC (7 AM Eastern in summer): **full** run, replacing whole months. Also removes records Fitbit deleted.
  - 14:00, 17:00, 20:00, 23:00, 02:00 UTC: **recent** runs (`?mode=recent`), upserting the last 3 days.
  - The route requires `Authorization: Bearer $CRON_SECRET`.
- **Manual:** `npm run health:sync`. Options: `--recent` for a light run, `--types daily-steps sleep`, `--start 2026-06-01` to replay from a date.

Every run is logged in `health_sync_runs`:

```sql
select id, trigger, scope, status, records, failed_types, error,
       started_at at time zone 'America/New_York' as started_et
from health_sync_runs
order by id desc
limit 5;
```

`scope` is `full` or `recent`; `status` is `succeeded`, `failed` or `running`; `failed_types` lists data types that failed while the rest continued. An `invalid_grant` error means the Google token needs re-authorizing.

## Project Map

```text
app/
  actions.ts                     server actions
  api/cron/health-sync/route.ts  health sync endpoint (Vercel Cron; ?mode=recent for light runs)
  charts.tsx                     inline SVG column and line charts (client; currently unused)
  entry-card.tsx                 saved meal display/editing
  home-progress-card.tsx         nutrition progress card (Log page)
  meal-logger.tsx                meal input and review flow
  page.tsx                       Today: score dials, nutrition, recovery, activity and workouts
  privacy/page.tsx               public privacy policy (linked from Google OAuth)
  refresh-button.tsx             manual Fitbit sync button on Today
  profile/page.tsx               Log: meal logging, history, date picker, goals
  shared-ui.tsx                  iOS shell (title, tab bar), login, goals form

lib/
  auth.ts                        session auth
  dates.ts                       date helpers
  goals.ts                       macro goal helpers
  health/google.ts               Google Health API client
  health/queries.ts              dashboard reads from health_daily / health_workouts
  health/scores.ts               sleep, recovery and strain scores
  health/sync.ts                 full and recent sync, run logging
  macro-adjust.ts                manual macro adjustment
  macro-parser.ts                OpenAI parser
  supabase.ts                    database access and summaries

scripts/
  health-auth.ts                 npm run health:auth
  health-sync.ts                 npm run health:sync

supabase/schema.sql              all tables and views (idempotent)
```
