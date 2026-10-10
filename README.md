# NutriBot

A personal health app that pairs a Fitbit with a Claude brain. Fitbit data flows in on its own: sleep, heart rate, HRV, steps and every workout. Logging is a chat: say what you ate or trained, and Claude turns it into structured records, matches workouts to the watch's sessions, and waits for you to tap Save.

**Live:** https://nutribot-dusky.vercel.app · **Roadmap:** [docs/mvp-plan.md](docs/mvp-plan.md) · **Agent guidelines:** [AGENTS.md](AGENTS.md)

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/today.png" width="240" alt="Today: sleep, recovery and strain scores, nutrition and water"><br><sub><b>Today</b>: scores from Fitbit, nutrition vs goals, water</sub></td>
    <td align="center"><img src="docs/screenshots/chat.png" width="240" alt="Chat: one message describing breakfast and a past workout, and Claude's reply"><br><sub><b>Chat</b>: one message, a meal and a workout</sub></td>
    <td align="center"><img src="docs/screenshots/chat-cards.png" width="240" alt="Draft cards: breakfast with item-level macros, and a workout matched to a Fitbit session"><br><sub><b>Drafts</b>: item-level macros; the workout matched to the watch</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/today-timeline.png" width="240" alt="Today's timeline: sleep, recovery, walks with strain, breakfast with macros"><br><sub><b>Timeline</b>: sleep, recovery, workouts, meals</sub></td>
    <td align="center"><img src="docs/screenshots/training.png" width="240" alt="Training: missing muscle groups and unlabeled Fitbit workouts"><br><sub><b>Training</b>: what's missing, what needs a label</sub></td>
    <td align="center"><img src="docs/screenshots/training-recent.png" width="240" alt="Training: 14-day coverage grid shaded by effort, sessions per muscle group, recent workouts"><br><sub><b>Coverage</b>: 14 days by muscle group, shaded by effort</sub></td>
  </tr>
</table>

## What it does

- **Today:** any day at a glance. Sleep, Recovery and Strain scores computed from Fitbit data, calories and macros against goals, water, a timeline of the day, and 7-day trends.
- **Chat:** "2 eggs and toast for breakfast", "chest and tris, hard", "Tuesday was back and bis, brutal". Claude answers with review cards. Meals come with item-level macro estimates. Workouts come with muscle groups and an effort score (RPE), already linked to the Fitbit workout they describe. Nothing is saved until you tap Save. Correct anything by just saying so ("actually 3 eggs").
- **Training:** the last 14 days by muscle group. It shows which groups haven't been trained in a week and suggests the next session, lists Fitbit workouts that still need a label (tap **Label** and finish the sentence in chat), and has a coverage grid shaded by effort and recent workouts with strain.

## How it works

```mermaid
flowchart LR
  subgraph Wrist
    F[Fitbit]
  end
  subgraph Google
    GH[Google Health API]
  end
  subgraph Vercel["Vercel (Next.js)"]
    CRON[Cron: 6 syncs a day]
    API["/api/brain"]
    SDK[Agent SDK → Claude Code binary]
    TOOLS["Tools: draft_meal · draft_workout · list_fitbit_workouts"]
    MATCH[Workout matcher]
    UI[Today · Training · Chat]
  end
  subgraph Supabase["Supabase Postgres"]
    RAW[(health_records JSONB)]
    VIEWS[(health_daily · health_workouts views)]
    LOGS[(macro_entries · workout_sessions · chat_messages)]
  end
  CL[Claude Sonnet]

  F --> GH --> CRON --> RAW --> VIEWS
  VIEWS --> UI
  LOGS --> UI
  UI -- message --> API --> SDK <--> CL
  SDK --> TOOLS --> MATCH --> VIEWS
  TOOLS -- drafts --> UI
  UI -- Save --> LOGS
  CRON -. links waiting workouts .-> LOGS
```

### 1. Fitbit data → Postgres

The watch syncs to Fitbit, and Fitbit's data is available through the **Google Health API**. NutriBot holds a Google OAuth refresh token with three read-only scopes (activity and fitness, health metrics, sleep) and pulls data on a schedule.

- **What comes in:** daily totals (steps, distance, calories, active and zone minutes), daily metrics (resting heart rate, HRV, SpO2, breathing rate, VO2 max), each sleep session with its stages, and each workout with its type, times, average heart rate and minutes in each heart-rate zone. Fitbit only: Apple Health records and minute-level samples are never stored.
- **How it's stored:** raw API payloads go into one JSONB table, `health_records`. Two SQL views, `health_daily` and `health_workouts`, unpack them into plain columns, so new fields need a view change, not a migration.
- **When:** six Vercel Cron jobs a day. One full run replaces whole months in a single transaction, which also drops anything Fitbit deleted. Five light runs upsert the last three days. Every run is logged in `health_sync_runs`. A Refresh button on Today runs one on demand.
- **Scores:** `lib/health/scores.ts` turns the views into Sleep (hours vs an 8-hour need), Recovery (today's HRV and resting heart rate against a 30-day baseline, plus sleep) and Strain (heart-rate zone minutes weighted by intensity, plus steps, per day and per workout). These are NutriBot's own estimates, not Whoop's formulas. The formulas are in [docs/scores.md](docs/scores.md).

### 2. The Claude brain

Chat runs **Claude through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)**, inside the same Vercel function that serves the app, signed in with the owner's Claude subscription.

1. The chat posts your message to `/api/brain`. The route loads the current conversation (last 10 messages) and any drafts still open on screen.
2. The Agent SDK starts the Claude Code binary as a subprocess (it ships with the function, about 260 MB) with NutriBot's own system prompt. All of Claude Code's built-in tools are switched off: no files, no shell, no web. Claude gets exactly three tools, served by an in-process MCP server, so the tool code runs right there in the function:

   | Tool | What it does |
   | --- | --- |
   | `draft_meal` | Builds a meal card: one row per food with calories, protein, carbs, fat and the portion it assumed, plus a meal type and a confidence. Totals are summed in code, not by the model. |
   | `draft_workout` | Builds a workout card: muscle groups, RPE ("hard" ≈ 8), and the Fitbit workout it matches. |
   | `list_fitbit_workouts` | Read-only: the watch's workouts in a date range, so Claude can pick out "the 6 PM lift on Tuesday". |

3. Claude calls the tools as often as the message needs. One message can be two meals and a workout, or just a question, which gets a plain answer. Every tool input is validated with Zod; an invalid call returns the error to Claude, which fixes it and tries again.
4. The reply and its drafts are stored in `chat_messages` and shown as cards. **Tools never write records.** Save writes the server's stored copy of the draft, never data sent from the browser, inside a transaction that also marks the draft saved so it can't be saved twice.
5. Revisions keep the same draft: "actually 3 eggs" calls `draft_meal` again with `replaces: <id>`, and the card updates in place.

A turn takes about 3–15 seconds on Sonnet. The full contract (draft shapes, the prompt rules, production setup) is in [docs/brain.md](docs/brain.md).

### 3. Matching a chat to a Fitbit workout

The watch records almost every workout, but it doesn't know what was trained. The chat supplies that, and the app has to work out which recorded session you mean. Some days have three or four, mostly auto-detected walks. Claude supplies the clues: the activity type, the day, and a time window if you gave one ("this morning"). **Plain code does the matching**, so it's deterministic and testable:

1. **Candidates:** that day's Fitbit workouts of a fitting type that aren't already labeled. Strength fits WEIGHTLIFTING, WEIGHTS, CORE_TRAINING and AEROBIC_WORKOUT; sport fits TENNIS, GOLF and SPORT; and so on.
2. **Time:** a time hint narrows the list to sessions overlapping that window. A same-day message with no hint picks the session that most recently ended ("just did chest" means the one that just finished).
3. **Result:** one candidate is a match. Several is a best guess, and the card's **Change** button lists the others.
4. **Not synced yet?** If today's workout hasn't arrived, the brain triggers a quick workout-only sync and tries again. If it's still missing, the workout is saved as *pending*, and every later sync links pending workouts that have exactly one candidate.
5. **Backfill:** each draft carries its own date, so "Monday chest and tris hard, Wednesday legs" makes two drafts, each matched on its own day. The Training tab lists unlabeled sessions with a **Label** button that opens the chat with the session already filled in.

Tested against the real Fitbit history (June–October 2026): after the type filter, 43 of 45 lifting days had exactly one candidate. Every sport, class and run day did too.

### 4. Meal logging

`draft_meal` estimates each food separately, states the portion it assumed, and sets a confidence. When confidence is low it asks the single most useful follow-up ("Which toppings did you get?"). It never pads the notes with "values may vary". Saved meals land in `macro_entries` with their meal type, appear in Today's timeline grouped by meal, and can be edited or deleted there.

### Data model

| Table | Holds |
| --- | --- |
| `health_records` | Raw Fitbit payloads (JSONB), one row per daily total, metric, sleep session or workout |
| `health_daily`, `health_workouts` | Views over `health_records` with plain columns and local times |
| `macro_entries` | Saved meals: items, macro totals, confidence, meal type |
| `workout_sessions` | Saved workouts: muscle groups, RPE, link to a Fitbit workout (`linked`, `pending` or `untracked`) |
| `chat_conversations`, `chat_messages` | Conversations (New chat starts one), each message, and the drafts shown with it |
| `user_macro_goals`, `water_entries` | Goals and water |

Everything is in [`supabase/schema.sql`](supabase/schema.sql), written to be safe to rerun.

## Roadmap

- **Public dashboards.** Make Today and Training readable by anyone with the link. Chat, saving and every edit stay behind the login.
- **Read tools for the brain**, so it can answer from your data: "how's my protein this week?", "when did I last train legs?".
- **Habits and journal** entries through chat.

Details and open questions: [docs/mvp-plan.md](docs/mvp-plan.md).

## Stack

- Next.js App Router, React, TypeScript, Server Actions; hand-rolled SVG charts
- Claude Agent SDK (Claude Sonnet), with in-process MCP tools validated by Zod
- Supabase Postgres, accessed server-side with `pg`
- Google Health API for Fitbit data
- Vercel hosting and Vercel Cron

## Developer setup

```bash
npm install
```

Create `.env.local` (see `.env.example`):

```bash
APP_USERS=Eric
APP_USER_PASSWORDS=Eric:your-password
AUTH_SECRET=your-long-random-cookie-signing-secret   # openssl rand -base64 32
APP_TIME_ZONE=America/New_York

CLAUDE_CODE_OAUTH_TOKEN=...   # claude setup-token; leave ANTHROPIC_API_KEY unset

DATABASE_URL=postgresql://postgres.your-project-ref:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Google Health sync
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...   # written by npm run health:auth
GOOGLE_HEALTH_USER=Eric
CRON_SECRET=...            # any long random string; Vercel Cron sends it
```

Create or update tables (safe to rerun):

```bash
psql "$DATABASE_URL" -f supabase/schema.sql
```

Run and build:

```bash
npm run dev
npm run build
```

### Claude token

```bash
claude setup-token                          # prints a token that lasts about a year
# put it in .env.local as CLAUDE_CODE_OAUTH_TOKEN, and in Vercel:
vercel env add CLAUDE_CODE_OAUTH_TOKEN production,preview --sensitive
npm run brain -- "chest and tris, hard"     # one turn in the terminal; writes nothing
```

In Vercel, `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` is also set, because the function that runs Claude is over the standard 250 MB limit.

### Authorizing Google

```bash
npm run health:auth
```

Opens Google's consent page, then asks for the redirected URL and saves `GOOGLE_REFRESH_TOKEN` to `.env.local`. The OAuth app is published but unverified, so Google shows an "unverified app" warning: choose **Advanced → Go to NutriBot**. After re-authorizing, copy the token to Vercel:

```bash
vercel env add GOOGLE_REFRESH_TOKEN production --sensitive
```

### Syncing

- **Scheduled:** six Vercel Cron jobs in `vercel.json` call `/api/cron/health-sync`, each once a day (the Hobby plan limit), ±59 minutes:
  - 11:00 UTC (7 AM Eastern in summer): **full** run, replacing whole months.
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

`failed_types` lists data types that failed while the rest continued. An `invalid_grant` error means the Google token needs re-authorizing.

## Project map

```text
app/
  page.tsx                       Today: day strip, scores, nutrition, goals, water, timeline, trends
  training/page.tsx              Training: missing groups, unlabeled workouts, coverage, sessions, recent workouts
  training-ui.tsx                Label button and workout editor
  chat/page.tsx                  Chat tab
  chat-sheet.tsx                 chat thread, draft cards, floating Chat button and sheet
  api/brain/route.ts             chat turns (POST) and the current conversation (GET)
  api/cron/health-sync/route.ts  health sync endpoint (Vercel Cron)
  actions.ts                     server actions: save/discard drafts, meal and workout edits, goals, water
  entry-card.tsx                 saved meal edit and delete
  charts.tsx                     inline SVG charts
  day-strip.tsx                  scrolling day picker
  refresh-button.tsx             manual Fitbit sync
  shared-ui.tsx                  iOS shell (title, tab bar), login, goals form
  privacy/page.tsx               public privacy policy (linked from Google OAuth)
  profile/page.tsx               redirects old Log links to /chat

lib/
  brain.ts                       chat brain: system prompt and tools (docs/brain.md)
  claude-brain.ts                runs Claude through the Agent SDK
  chat.ts                        conversations, messages, draft saving
  workouts.ts                    logged workouts and Fitbit matching
  macros.ts                      meal macro schema and totals
  health/google.ts               Google Health API client
  health/sync.ts                 full and recent sync, run logging, workout auto-linking
  health/queries.ts              reads from health_daily / health_workouts
  health/scores.ts               sleep, recovery and strain scores
  supabase.ts                    database access and summaries
  auth.ts, dates.ts, goals.ts, macro-adjust.ts

scripts/
  brain.ts                       npm run brain: one chat turn in the terminal, writes nothing
  health-auth.ts                 npm run health:auth
  health-sync.ts                 npm run health:sync

supabase/schema.sql              all tables and views (safe to rerun)
docs/                            brain.md, training-plan.md, scores.md, mvp-plan.md, screenshots/
```
