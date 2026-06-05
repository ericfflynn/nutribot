# NutriBot Macros

NutriBot Macros is a private macro tracker for logging meals in plain English, reviewing AI-generated estimates, and tracking progress against personal goals.

It is built as a focused product demo: fast meal entry, transparent AI output, editable nutrition data, and a rolling 7-day view that reflects actual logged behavior.

## Highlights

- Plain-English meal logging with OpenAI macro estimates.
- Review step with calories, protein, carbs, fat, confidence, notes, and item breakdowns.
- Correction flow for revising estimates before saving.
- Manual macro editing when the user knows better than the model.
- Rolling 7-day dashboard that excludes today and days with no logged meals.
- Date picker for reviewing, editing, or backfilling recent days.
- Per-user calorie and macro split goals.
- Private auth, server-side AI calls, and Supabase persistence.

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

- Next.js App Router
- TypeScript
- React Server Actions
- OpenAI structured outputs
- Supabase Postgres
- Vercel

## Developer Setup

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```bash
APP_USERS=Eric,Bella
APP_USER_PASSWORDS=Eric:your-eric-password,Bella:your-bella-password
AUTH_SECRET=your-long-random-cookie-signing-secret
APP_TIME_ZONE=America/New_York

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

DATABASE_URL=postgresql://postgres.your-project-ref:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

Generate `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Create tables:

```text
Run supabase/schema.sql in the Supabase SQL editor.
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

## Project Map

```text
app/
  actions.ts              server actions
  entry-card.tsx          saved meal display/editing
  home-progress-card.tsx  progress card
  meal-logger.tsx         meal input and review flow
  page.tsx                home dashboard
  profile/page.tsx        logging, history, date picker
  shared-ui.tsx           shell, login, goals form

lib/
  auth.ts                 session auth
  dates.ts                date helpers
  goals.ts                macro goal helpers
  macro-adjust.ts         manual macro adjustment
  macro-parser.ts         OpenAI parser
  supabase.ts             database access and summaries
```
