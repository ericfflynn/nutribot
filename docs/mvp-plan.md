# NutriBot MVP plan

Status: agreed direction as of October 8, 2026. Replaces the October 1 wellbeing POC review.

## Goal

A private, phone-first health app where chat is the main way to record things. You describe a meal, workout, habit or how the day went; the assistant turns it into validated structured records, asks when details are missing, and only reports success after the write lands. The dashboard reads those records alongside wearable data from Google Health.

This repo is the base. The existing meal logger, dashboard and goals stay working while chat is added; they are not rebuilt.

## MVP scope

1. **Google Health data in Postgres.** Raw payloads loaded into JSONB tables on a schedule. No normalized health schema yet; views get added once we know which fields matter.
2. **Chat with tool use.** Claude API with a manual tool loop on the server, replacing the OpenAI meal parser. Six tools:
   - `logMeal`: items and macro estimates, saved to `macro_entries`.
   - `logWorkout`: type, duration, intensity, notes.
   - `logHabitEvent`: a named habit and when it happened.
   - `writeJournalEntry`: free text for the day.
   - `queryHealthData`: read-only access to the Google Health records and logged data.
   - `getUserGoals`: macro targets and other goals.
3. **Write rules.** Inputs are validated with Zod before any write. Missing required details are asked for, not guessed. The assistant says "logged" only when the tool result confirms the database write.
4. **Mobile dashboard.** Read-focused views of today and recent trends, built from the logged and ingested data.

## Out of scope for the MVP

- Minute-level data of any kind. Daily totals, daily metrics and per-workout summaries only.
- Apple Health data.
- Normalized health analytics, derived trends and baselines.
- Goal/experiment tracking, learned memories, background autonomy.
- Apple Health, Whoop and other sources.

## Architecture

- Next.js App Router on Vercel, TypeScript, server actions. Production: https://nutribot-dusky.vercel.app
- Supabase Postgres, accessed from the server through `DATABASE_URL` (`pg`).
- Claude API from server code only. API keys and Google tokens never reach the browser.
- Health sync runs daily as a Vercel Cron route (`vercel.json`), and on demand with `npm run health:sync`.

## Data

Existing tables stay as they are: `macro_entries`, `user_macro_goals`.

Google Health raw store (schema in `supabase/schema.sql`):

| Table | Purpose |
| --- | --- |
| `health_records` | One row per daily total, daily metric, sleep session or workout: user, data type, monthly partition, record key, raw `payload` JSONB, fetch time. |
| `health_sync_state` | Per user and data type: covered-through date and last successful sync. |

New tables for chat writes (workouts, habit events, journal entries, chat messages) get designed with the tools in milestone 3.

## Google Health ingestion

Ported from the tested Python implementation in `../../nutribot-core`, then narrowed to what the MVP needs.

- **Fitbit only.** Google Health also returns Apple Health (`HEALTH_KIT`) and untagged records; they are dropped before storage.
- **Daily totals for activity.** Steps, distance, active energy, total calories, active minutes and active zone minutes come from the `dailyRollUp` endpoint, restricted to the `google-wearables` source family (Fitbit and Google trackers). One row per day. Minute-level data is never downloaded.
- **Daily and session records as returned.** Resting heart rate, HRV, sleep, SpO2, respiratory rate, VO2 max, heart rate zones, sleep temperature, and one record per workout (`exercise`: start/end, type, active duration, calories, average heart rate, distance, steps, time in zones). Weight and body fat are synced if they are ever logged in Fitbit.
- **Not synced:** minute-level heart rate, and floors and basal energy, which the API returns without a data source.
- **Backfill** starts January 1, 2026; Fitbit data begins in June.
- **Monthly snapshots.** Each data type is fetched one calendar month at a time, then one transaction replaces that month's rows and advances the checkpoint. A failure leaves the previous snapshot and checkpoint intact; rerunning resumes.
- **Incremental runs** start seven days before the last checkpoint, rounded down to the start of that month, so late uploads and corrections are picked up.
- **Record keys:** the API record name, or the date for daily totals.
- **Credentials:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` as server env vars. Three read-only scopes: activity and fitness, health metrics, sleep. `npm run health:auth` issues a new refresh token.

Storage is about 1.4 MB for January through early October.

## Privacy rules

- Health records, meal logs and tokens stay out of Git, docs, PR text, screenshots and ordinary logs. Use counts or synthetic data.
- Errors from the Google client report status codes, never response bodies or URLs.
- The app has one user (Eric). Queries still scope by the session user so a second account can't see another's data if one is ever added.
- Raw prompts and responses are not logged.
- Missing data stays missing; it is never filled in as zero or inferred.

## Milestones

1. **Plan** (this document).
2. **Raw health load.** Done locally: health tables in Supabase, `npm run health:auth` and `npm run health:sync`.
3. **Scheduled sync.** Done: daily Vercel Cron (`/api/cron/health-sync`, 11:00 UTC), Google credentials in Vercel env vars, every run logged in `health_sync_runs`.
4. **Chat.** `/chat` page, Claude tool loop, the six tools, new write tables, persisted conversation history.
5. **Dashboard.** Mobile views over logged data and health data.

## Open questions

- **Google re-authorization.** The OAuth app is published (unverified, which is fine for personal use), so refresh tokens no longer expire after 7 days. Re-auth is `npm run health:auth`; an in-app connect flow can come later if needed.
- **Authentication.** The app uses its own login with env-var passwords and signed cookies. Move to Supabase Auth before adding health data and chat, or keep custom auth for the MVP?
- **Model disclosure.** Which records may be sent to the Claude API in chat context (all logged data, health summaries, raw payloads)?
- **Health fields.** Which payload fields become views or dashboard metrics, once the raw data is loaded and inspected.
