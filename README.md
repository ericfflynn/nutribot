# NutriBot

A personal health app built around one idea: **a single daily model of body and mind**, built from everything a person's watch records and everything they tell it.

A Fitbit supplies sleep, heart rate, HRV, temperature, breathing and every workout on its own. Meals, workouts, moods, habits and sick days are logged by chatting with Claude, which turns plain sentences into structured records and waits for a tap on Save. Code then combines all of it into the **body state**: one stored JSON picture per day, organized into domains, areas and signals. The Today screen, Training's suggestion, illness detection and the chat all read that same picture.

**Live:** https://nutribot-dusky.vercel.app (private) · **Body state spec:** [docs/body-state.md](docs/body-state.md) · **Agent guidelines:** [AGENTS.md](AGENTS.md)

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/today.png" width="240" alt="Today: the morning check-in with the day's call, sleep, recovery and strain scores, and nutrition"><br><sub><b>Today</b>: the morning brief and call, scores, nutrition</sub></td>
    <td align="center"><img src="docs/screenshots/today-sick.png" width="240" alt="A sick day: red recovery, high resting heart rate and the sick line under the scores"><br><sub><b>A sick day</b>: red recovery, the illness line</sub></td>
    <td align="center"><img src="docs/screenshots/today-recovery.png" width="240" alt="Recovery opened: 7 days of recovery, resting HR and HRV against their usual"><br><sub><b>Recovery</b>: 7 days, each vital against its usual</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/chat.png" width="240" alt="Chat explaining a bad recovery week: a night of drinks, then a cold the watch saw coming"><br><sub><b>Chat</b>: answers from the stored body states</sub></td>
    <td align="center"><img src="docs/screenshots/chat-cards.png" width="240" alt="A meal draft card with macros, caffeine and added sugar, waiting for Save"><br><sub><b>Logging</b>: a meal draft, saved on tap</sub></td>
    <td align="center"><img src="docs/screenshots/today-timeline.png" width="240" alt="The day's timeline: sleep, recovery, meals with macros, and a workout with strain"><br><sub><b>The day</b>: watch data and logs on one timeline</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/training.png" width="240" alt="Training: front and back body map shaded by soreness"><br><sub><b>Training</b>: soreness per muscle on a body map</sub></td>
    <td align="center"><img src="docs/screenshots/training-next.png" width="240" alt="Next up: fresh and out muscles, a suggested leg day with intensities, and the weekly split"><br><sub><b>Next up</b>: what's fresh, what's out, the suggested day</sub></td>
    <td align="center"><img src="docs/screenshots/habits.png" width="240" alt="Habits: a 14-day grid colored by each habit's own bands, and the journal's tags"><br><sub><b>Habits and journal</b>: per-habit color bands, tags</sub></td>
  </tr>
</table>

<sub>Screenshots show a fictional demo user with six weeks of generated data, including a cold and some weekend drinks ([docs/demo.md](docs/demo.md)).</sub>

## The body state

Most health apps show each source on its own screen: a sleep chart here, a workout log there, a mood graph somewhere else. Nothing ties them together, so they can disagree. On October 30, 2026, NutriBot's workout planner suggested a hard pull day while the owner was sick and the watch showed it. The body state was built to fix that: **one model, every reader**. If two screens disagree, one of them is a bug.

### Shape

One JSON object per user per day, built by a pure function, `buildBodyState(sources, date)`, and unit-tested.

```
body state
├── physical                 domain: status + headline
│   ├── sleep                area: status + headline + signals
│   ├── recovery
│   ├── vitals               resting HR, HRV, sleep temperature, breathing, SpO2, each against a personal baseline
│   ├── illness              well → early signs → sick → easing back
│   ├── load                 strain, hard-day streaks, days since rest
│   ├── training             which day types are due
│   └── fuel                 calories, protein, water, caffeine, added sugar
├── mental
│   └── mood                 mood, stress and energy from the journal
├── lifestyle
│   ├── habits               goals met or missed, streaks
│   ├── career               work stress and work tags
│   └── relationships        family, partner, friends
└── explanations[]           what else could explain today's numbers
```

Every domain and area has the same head: a `status` (`good`, `ok`, `watch`, `low` or `unknown`) and a one-line `headline` that names its evidence. An area's status comes from a simple rule a person can check in their head, such as "watch when resting HR is 2+ above usual". A domain takes its worst known area. So a day reads "Physical: low · Mental: ok · Lifestyle: watch", and any reader can drill down to the signal that set it.

Here is the day before demo's cold, trimmed:

```json
{
  "physical": {
    "status": "low",
    "headline": "20, red, not green 12 days running, after 2 hard days in a row",
    "recovery": { "status": "low", "score": 20, "band": "red", "vsPrior7": -23 },
    "vitals": {
      "status": "low",
      "headline": "Resting HR 62, usually 56 · HRV 34 ms, usually 49",
      "restingHr": { "value": 62, "usual": 55.9, "delta": 6.1, "z": 3.8, "streak": 1 },
      "sleepTemp": { "value": 0.79, "usual": 0, "delta": 0.7, "z": 3.7, "streak": 1 },
      "breathing": { "value": 15.8, "usual": 14.6, "delta": 1.2, "z": 4, "streak": 1 }
    },
    "illness": {
      "status": "watch",
      "phase": "early_signs",
      "signal": { "level": "likely", "points": 6 },
      "headline": "Early signs: Resting HR 62, usually 56 · Sleep temperature +1.4°F (2 hard days in a row may explain some of it)"
    }
  },
  "mental": { "status": "ok", "headline": "Mood 3 (neutral / okay)" },
  "lifestyle": { "status": "watch", "headline": "Late screens: missed 3 of the last 5 days" },
  "explanations": [
    { "kind": "load", "detail": "2 hard days in a row", "affects": ["resting_hr", "hrv", "recovery"], "source": "physical.load" }
  ]
}
```

The next morning demo logged a fever. The watch had flagged it a day early.

### Principles

- **Code builds facts; Claude judges; the owner's word wins.** Numbers, baselines, streaks and statuses are computed deterministically. Claude reads them and talks about them, but never invents them. What the owner reports (sick, sore, "it was just drinks") overrides what the data suggests.
- **Every judgment shows its evidence.** A headline points at fields ("resting HR 62, usually 56"), never at a vibe.
- **Missing is null.** No guessed values and no zeros for "no data". Charts show missing days as gaps.
- **Personal baselines, not population norms.** Each vital is compared with the same person's days −31 to −4. Logged sick days are left out of that window, so an illness can't hide itself.
- **Explanations before alarms.** A raised resting HR after three drinks, a late coffee, a hard training block or a stressful week is not an illness. The state collects those explanations first, and the illness and recovery headlines name them.

### Stored as versions

Each day's state is saved in Postgres as JSONB, in `body_states`. JSONB keeps the model free to grow while it's young, and Postgres can still query inside it.

```sql
body_states (user_name, state_date, version, trigger, schema_version, state jsonb, state_hash, built_at)
body_state_current   -- view: each day's newest version
```

- **Days aren't final when they end.** Meals get logged late and the watch syncs late. A save rebuilds that day and every day after it, since streaks, baselines and sick-day episodes reach forward. Each health sync rebuilds the last three days.
- **Versions, not overwrites.** The newest version is the day's truth. Older ones remain a record of what the app believed at the time, which is how early warnings can later be checked against what actually happened.
- **No empty versions.** A rebuild is saved only when `state_hash` changes, so the table grows by real changes rather than by rebuilds.
- **Schema versions with upgrade-on-read.** Each row carries the shape it was written in, and readers upgrade old rows in code. Nothing in the database is ever migrated.
- **Full rebuilds** after a rule change take seconds: `npm run body:states -- --apply` rebuilds every day since June.

The chat reads it through two tools: `get_body_state` for one day, and `list_body_states` for a range ("why was my recovery bad two weeks ago?").

### What's next for it

The spec ([docs/body-state.md](docs/body-state.md#build-order)) has six steps. Steps 1 and 2, the model and its storage, are built:

3. **Causes and effects:** measure from the owner's own history how much drinks, late caffeine or work stress actually move sleep, resting HR and HRV.
4. **Guardrails and the call:** code sets what's allowed today (rest, the most intensity, which muscles are out), and Claude makes the day's call within those limits.
5. **Morning push:** the brief and call arrive as a notification that opens the chat.
6. **Tuning:** check early warnings against the sick days that were logged, and adjust the thresholds.

## How the data flows

```mermaid
flowchart LR
  subgraph Sources
    F[Fitbit via Google Health API]
    C[Chat with Claude]
    T[Taps: water, soreness, habits]
  end
  subgraph Raw["Stored as received"]
    HR[(health_records<br/>raw JSONB)]
    LOGS[(meals · workouts · journal<br/>habits · sick days · soreness)]
  end
  subgraph Derived["Derived in SQL and code"]
    V[(health_daily · health_workouts<br/>views)]
    S[scores · illness signal<br/>workout dedupe · soreness]
  end
  BS[(body_states<br/>one versioned JSON per day)]
  subgraph Readers
    TODAY[Today]
    TRAIN[Training]
    CHAT[Chat]
    PUSH[Pushes]
  end

  F -- 6 syncs a day --> HR --> V --> S
  C -- drafts, saved on tap --> LOGS
  T --> LOGS
  LOGS --> S
  S --> BS
  BS --> TODAY & TRAIN & CHAT & PUSH
```

### 1. Watch data: raw in, views out

The watch's data comes through the **Google Health API**, read with a read-only OAuth token.

- **Raw payloads, one table.** Every daily total, metric, sleep session and workout lands in `health_records` exactly as the API returned it (JSONB, keyed by type and record). Two SQL views, `health_daily` and `health_workouts`, unpack the JSON into plain columns with local times. A new field is a view change, not a migration.
- **Syncs.** Six Vercel Cron jobs a day: one full run replaces whole months in a single transaction, which also drops anything Fitbit deleted, and five light runs upsert the last three days. Opening the app runs a light sync too. Every run is logged in `health_sync_runs`.
- **Duplicates folded at the data layer.** The watch sometimes records one workout twice. `health_workout_merges` records which recordings are the same workout, and `health_workouts` shows one row per workout ([docs/workout-dedupe.md](docs/workout-dedupe.md)).
- **Scores.** `lib/health/scores.ts` computes Sleep (hours against an 8-hour need), Recovery (HRV and resting HR against a 30-day baseline, plus sleep) and Strain (heart-rate zone minutes and steps). These are NutriBot's own formulas, documented with their limitations in [docs/scores.md](docs/scores.md).
- **Illness signal.** `lib/health/illness.ts` scores each morning on resting HR, sleep temperature, HRV and breathing against the personal baseline, and pushes once when illness is likely ([docs/illness.md](docs/illness.md)).

### 2. Logged data: chat in, structured records out

Chat runs **Claude through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)** inside the app's Vercel function. Claude Code's built-in tools are switched off (no files, no shell, no web), and Claude gets only NutriBot's own tools, served in-process and validated with Zod:

| Kind | Tools |
| --- | --- |
| **Drafts** (cards the owner saves) | `draft_meal` (items with macros, caffeine and added sugar), `draft_workout` (muscles, intensity, the matching watch workout), `draft_journal`, `draft_habits`, `draft_habit`, `draft_illness`, `draft_ignore_workout`, `draft_feedback` |
| **Reads** | `get_body_state`, `list_body_states`, `get_health`, `get_goals`, `list_meals`, `list_workouts`, `list_journal`, `list_habits`, `list_habit_logs`, `list_illness`, `list_feedback` |

- **Tools never write.** A draft is shown as a card, and Save writes the server's stored copy inside a transaction that also marks it saved, so it can't be saved twice.
- **Talking comes first.** Not every message is a log. "Log that" and "just chatting" override the chat's guess. Feelings get a one-tap "Save to journal" offer instead of a form, and questions get answers from the data.
- **Totals in code.** Claude estimates each food; code sums the meal.
- **Workout matching is plain code.** Claude supplies clues (type, day, a time window); deterministic code picks the watch's recording from that day's candidates, or saves the workout as *pending* until the recording syncs.

The full contract is in [docs/brain.md](docs/brain.md).

### 3. Training

Training reads logged workouts and the owner's soreness taps ([docs/training-plan.md](docs/training-plan.md)):

- **Soreness per muscle**, 0 to 3. Workouts set it (light 1, medium 2, hard 3) and it fades 0.75 a day. A tap on the body map overrides it in either direction.
- **Volume:** 4 points per muscle per rolling week. A hard session is worth 3 points, medium 2 and light 1.
- **Next up:** which muscles are fresh and which are out, then the day type (push, pull, legs, arms, shoulders) whose fresh muscles are most overdue. It applies rules stored as data, such as "no back the day after forearms" and "at most 2 hard days in a row", and takes illness from the body state.

### 4. Habits and journal

Habits are a goal plus a direction (build or limit) with optional cutoffs, weekdays and **per-habit color bands** (for example, alcohol is orange over 2 and red over 3). They're all set from the chat or the Habits tab, with no code change. Journal entries carry mood, optional stress and tags in categories such as Work, Relationships and Health, which feed the mental and lifestyle domains.

## Data model

| Layer | Table or view | Holds |
| --- | --- | --- |
| Raw | `health_records` | Watch payloads as received (JSONB): daily totals, metrics, sleep sessions, workouts |
| Raw | `health_sync_runs` | Every sync: scope, status, records, failed types |
| Derived | `health_daily`, `health_workouts`, `health_workout_records` | Views with plain columns and local times; workouts with duplicates folded |
| Derived | `health_workout_merges`, `workout_ignores` | Which recordings are one workout; recordings to leave out |
| Logged | `macro_entries` | Meals: items, macros, caffeine, added sugar, meal type, time |
| Logged | `workout_sessions` | Workouts: muscles, per-muscle intensity, RPE, link to a watch recording |
| Logged | `journal_entries`, `habits`, `habit_logs` | Mood, stress, tags; habits with goals and bands; daily amounts |
| Logged | `illness_days`, `body_log` | Sick days with severity and symptoms; soreness per muscle |
| Logged | `water_entries`, `user_macro_goals` | Water; calorie, macro, water, caffeine and sugar goals |
| Model | `body_states`, `body_state_current` | The body state, one versioned JSON per day |
| App | `chat_conversations`, `chat_messages`, `app_feedback` | Chat threads with their drafts; bugs and ideas told to the chat |
| App | `reminders`, `reminder_sends`, `push_subscriptions` | Push reminders and the phones that get them |

Everything is in [`supabase/schema.sql`](supabase/schema.sql), written to be safe to rerun. Every table is scoped by `user_name`.

## Stack

- Next.js App Router, React, TypeScript, Server Actions; hand-rolled SVG charts
- Claude Agent SDK (Claude Sonnet) with in-process MCP tools validated by Zod
- Supabase Postgres, accessed server-side with `pg`
- Google Health API for Fitbit data; Web Push for reminders
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

# Push reminders
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

Create or update tables (safe to rerun):

```bash
psql "$DATABASE_URL" -f supabase/schema.sql
```

Run, test and build:

```bash
npm run dev
npm test           # unit tests: body state, illness, training, habits, workout dedupe, ...
npm run build
```

Other scripts:

| Command | Does |
| --- | --- |
| `npm run brain -- "chest and tris, hard"` | One chat turn in the terminal; writes nothing |
| `npm run health:sync` | Sync now (`--recent` for the last 3 days) |
| `npm run body:states` | Rebuild stored body states (dry run; `-- --apply` writes) |
| `npm run demo:seed -- --main` | Fictional demo user for screenshots ([docs/demo.md](docs/demo.md)) |
| `npm run db:backup` | Dump the database to `backups/` |
| `npm run feedback` | Open bugs and ideas told to the chat |

### Claude token

```bash
claude setup-token                          # prints a token that lasts about a year
# put it in .env.local as CLAUDE_CODE_OAUTH_TOKEN, and in Vercel:
vercel env add CLAUDE_CODE_OAUTH_TOKEN production,preview --sensitive
```

In Vercel, `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` is also set, because the function that runs Claude ships the Claude Code binary and is over the standard 250 MB limit.

### Authorizing Google

```bash
npm run health:auth
```

This opens Google's consent page, asks for the redirected URL, and saves `GOOGLE_REFRESH_TOKEN` to `.env.local`. The OAuth app is published but unverified, so Google warns about an unverified app; choose **Advanced → Go to NutriBot**. Then copy the token to Vercel with `vercel env add GOOGLE_REFRESH_TOKEN production --sensitive`.

### Scheduled jobs

- **Health sync:** six Vercel Cron jobs call `/api/cron/health-sync`: a full run at 13:00 UTC and `?mode=recent` runs at 16:00, 19:00, 22:00, 01:00 and 04:00 UTC. The Hobby plan allows each job once a day. An `invalid_grant` error in `health_sync_runs` means the Google token needs re-authorizing.
- **Reminders:** 24 hourly jobs call `/api/cron/reminders`, and each sends the reminders due in that local hour.
- Both routes require `Authorization: Bearer $CRON_SECRET`.

## Project map

```text
app/
  page.tsx                Today: day strip, check-in, scores, nutrition, timeline, goals
  today-checkin.tsx       morning brief and evening check-in card (swipe to dismiss)
  score-summary.tsx       Sleep / Recovery / Strain with their 7-day drill-downs
  nutrition-toggle.tsx    Nutrition card that opens its week
  training/page.tsx       Training: body map, Next up, week grid, recent workouts
  body-map.tsx            front and back muscle map shaded by soreness
  habits/page.tsx         Habits: habit grid, check-in, journal, reminders
  chat/page.tsx           Chat tab
  chat-sheet.tsx          chat thread, draft cards, floating Chat button
  charts.tsx              hand-rolled SVG charts
  actions.ts              server actions: save drafts, edits, goals, water, soreness
  api/brain/route.ts      chat turns
  api/cron/               health sync and reminders

lib/
  body-state/             the body state: types, build (pure), load, store (versions), brief
  health/                 Google Health client, sync, views, scores, illness signal, dedupe
  brain.ts                chat brain: system prompt and tools (docs/brain.md)
  brain-*.ts              tool groups: body, health, check-in (journal and habits)
  claude-brain.ts         runs Claude through the Agent SDK
  workouts.ts             workouts, soreness, volume, Next up, Fitbit matching
  habits.ts, journal.ts   habits with bands; journal entries and tags
  illness.ts              sick days and their chat tools
  nutrients.ts            caffeine and added sugar per day
  auth.ts, dates.ts, goals.ts, supabase.ts

scripts/                  sync, auth, brain, body-states, demo-seed, backup, feedback
supabase/schema.sql       all tables and views (safe to rerun)
tests/                    unit tests (Node test runner + tsx)
docs/                     body-state.md, brain.md, scores.md, illness.md, training-plan.md,
                          journal-habits-plan.md, workout-dedupe.md, decisions.md, demo.md
```
