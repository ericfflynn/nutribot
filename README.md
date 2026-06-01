# NutriBot Macros

A small private macro tracker built for quick deployment on Vercel.

This branch is a focused Next.js app. It does not use the old Python MCP/CLI implementation.

## What It Does

- Password login for two allowlisted users.
- Plain-English meal input.
- Server-side OpenAI macro estimation.
- Review step before saving.
- Correction/revision flow before accepting a meal.
- User-editable macro goals by calories and protein/carbs/fat percentage split.
- Supabase Postgres persistence.
- Today dashboard for calories, protein, carbs, and fat.
- Week-to-date daily averages against each participant's goals.
- Meal history with every meal logged today and at least the five most recent meals.

## Stack

- Next.js App Router
- TypeScript
- React Server Actions
- OpenAI API
- Supabase Postgres
- Vercel deployment target

## Project Structure

```text
app/
  actions.ts          server actions for auth, parsing, revision, and save
  meal-logger.tsx     meal input, pending state, review, accept/revise UI
  page.tsx            main dashboard page
  globals.css         app styling
lib/
  auth.ts             cookie session and per-user password auth
  dates.ts            app-local date helper
  macro-parser.ts     OpenAI macro parser
  supabase.ts         database reads/writes
supabase/
  schema.sql          macro_entries table
```

## Environment

Create `.env.local` for local development:

```bash
APP_USERS=Eric,Bella
APP_USER_PASSWORDS=Eric:your-eric-password,Bella:your-bella-password
AUTH_SECRET=your-long-random-cookie-signing-secret
APP_TIME_ZONE=America/New_York

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

DATABASE_URL=postgresql://postgres.your-project-ref:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

Generate `AUTH_SECRET` with:

```bash
openssl rand -base64 32
```

For Vercel, set the same environment variables in Project Settings. Use Supabase's transaction pooler connection string for `DATABASE_URL`.

## Database

Run [supabase/schema.sql](supabase/schema.sql) in the Supabase SQL editor before testing meal logging.

## Run

```bash
nvm use
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy

Deploy as a normal Next.js app on Vercel. Keep all secrets server-side; do not use `NEXT_PUBLIC_` variables for OpenAI or the database.
