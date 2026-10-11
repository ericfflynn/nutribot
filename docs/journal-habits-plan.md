# Journal, habits and reminders plan

Status: built October 10, 2026 (journal, habits, Habits tab, reminders); reminders go live once VAPID keys are in Vercel.

## Goal

Morning and evening check-ins in chat that record how the day went (stress, energy, soreness), plus habits the owner wants to watch (weed, nicotine, alcohol, reading, late gaming). After a few weeks, compare them against sleep, HRV and recovery: "nights with heavy nicotine use, recovery averages 9 points lower the next morning."

Everything is private ([mvp-plan.md](mvp-plan.md#privacy-stance)). The chat brain may read all of it.

## Journal

The owner writes or dictates an entry in chat, as often as he likes; morning and before bed are the usual times. Claude drafts the entry, and he saves it like a meal.

`journal_entries`, one row per entry:

| Column | Notes |
| --- | --- |
| `entry_date` | Local date the entry is about. A 1 am entry about the previous evening belongs to the previous day; Claude decides from the text. |
| `kind` | `morning`, `evening` or `other`. |
| `body` | The entry in his words, lightly cleaned up (typos, filler); never summarized away. |
| `mood`, `energy`, `stress`, `soreness` | 1–5 each, or null when the entry doesn't say. Claude never guesses a rating the text doesn't support. |
| `tags` | Short labels for what came up: `work`, `sore legs`, `poor sleep`, `social`. Free-form, reused where possible. |
| `created_at` | When it was saved. |

The morning prompt leans toward sleep and soreness; the evening one toward the day, stress and habits.

## Habits

Habits are rows, not code, so new ones are added by telling the chat "start tracking caffeine."

`habits`, one row per tracked habit:

| Column | Notes |
| --- | --- |
| `name` | "Nicotine". Unique per user. |
| `measure` | `intensity` (1–3), `count` (with a `unit`, e.g. drinks) or `minutes`. |
| `direction` | `limit` (less is better) or `build` (more is better). |
| `scale_guide` | For `intensity` habits: what light, moderate and heavy mean, so every log is rated the same way. Claude drafts it when the habit is added; the owner can change it. |
| `goal` | The day's target. Limit habits: the most that's OK (0 = none). Build habits: the least. |
| `cutoff` | Optional local time after which any use is a miss (Gaming: 20:00). |
| `cutoff_weeknights` | The cutoff applies Sunday–Thursday only. |
| `active` | Archived habits keep their history. |

Starting set:

| Habit | Measure | Direction | Scale guide |
| --- | --- | --- | --- |
| Nicotine | intensity | limit | Goal: none. 1: one or two pouches. 2: several pouches, or a few vape hits. 3: vaping on and off all day, or cigarettes. |
| Weed | intensity | limit | Goal: none. 1: a small gummy (≤5 mg). 2: a standard edible (~10 mg) or a shared joint. 3: bong rips, several sessions, or a strong edible. |
| Alcohol | count (drinks) | limit | Goal: none. |
| Reading | minutes | build | Goal: 15 minutes. |
| Gaming (Xbox) | minutes | limit | No playing after 8 pm on weeknights (cutoff 20:00, weeknights only). |

`habit_logs`, one row per use (or per "none" for a day):

| Column | Notes |
| --- | --- |
| `habit_id`, `entry_date` | |
| `amount` | Intensity 1–3, drinks, or minutes. **0 means "didn't today"**, said explicitly. |
| `details` | His words: "1 Zyn 6mg on the golf course". |
| `started_at`, `ended_at` | Optional local times. Late use affects sleep more, and for Gaming they give how late he played. An `ended_at` earlier than `started_at` means after midnight; the log still belongs to the evening's date. |

A day's level per habit: the highest intensity (or the total drinks or minutes) that day, plus the number of uses. Habits with a cutoff also get the latest end time and the minutes past the cutoff ("played 2h, until 11:40 pm, 1h 40m after 8"). A day with no rows is unknown, not zero, so it never skews comparisons. The evening check-in asks about any active habit he hasn't mentioned that day, which is how the zeros get recorded.

## Goal met or missed

Each logged day is judged against the habit's goal (`habitOutcome` in `lib/habits.ts`) and colored in the Habits tab's grid: green when met, yellow, orange or red for a small, medium or big miss, gray when not logged.

- **Limit habits:** over the goal by 1, 2 or 3+ intensity steps or drinks; for minutes, up to 25%, 75% or more over.
- **Cutoff:** minutes past the cutoff, under 30, up to 90, or more. Needs start and end times; a weeknight use without them shows as "can't tell".
- **Build habits:** at least half the goal is a small miss, less is medium, an explicit zero is big.
- An explicit zero on a limit habit is a met goal.

## Chat tools

Same draft-then-Save flow as meals ([brain.md](brain.md)).

| Tool | Does |
| --- | --- |
| `draft_journal` | A journal entry with ratings and tags. |
| `draft_habits` | One card holding a day's habit logs, including the zeros. |
| `draft_habit` | Adds or changes a tracked habit, including its scale guide. |
| `list_habits` | Read-only: active habits with their scale guides; Claude reads it before rating a use. |
| `list_journal` | Read-only: entries and ratings in a date range. |
| `list_habit_logs` | Read-only: logs and daily levels in a date range. |

An evening check-in usually ends with two cards: the journal entry and the day's habits.

## Habits tab

- Check-in card: today's journal ratings and a Check in button.
- The 14-day grid, colored by outcome. Tapping a square opens that habit and day below the grid, to log a use, a "none", or remove an entry; tapping a name opens today. Intensity habits log with one tap (None, Light, Moderate, Heavy); drinks with a counter; minutes with optional start and end times.
- Journal history, tracked habits with their goals and scale guides, and the Reminders switch.

## On Today

- Journal entries and habit uses appear as timeline rows at the time they were saved; tapping a journal row shows the text.
- A small Check-in card: today's ratings, and which habits are logged, zero, or unknown.
- Trends that compare habits with sleep and recovery come later, once there are 3–4 weeks of data.

## Reminders

iPhone web push to the Home Screen app (iOS 16.4+; it does not work in a Safari tab).

**Schedule.** One notification at most, in the 8 pm hour (Vercel's free cron fires anywhere in the hour, which is fine):

| Night | Journaled today | Not journaled |
| --- | --- | --- |
| Weeknight (Sun–Thu) | "8 pm: Xbox off, start winding down for bed." | "8 pm: Xbox off. Quick journal before bed?" |
| Fri, Sat | nothing | "How was today? Take a minute to journal." |

Weeknights are the nights before a workday, Sunday through Thursday. Tapping a notification opens the chat ready for an evening check-in.

**Timing.** Vercel cron runs in UTC, and 8 pm Eastern is 00:00 UTC in summer and 01:00 UTC in winter. Two daily jobs run at both hours; only the one landing in the 8 pm local hour sends. `reminder_sends` records each send, so a day never gets two.

**Pieces.**
- A web app manifest (`app/manifest.ts`, `display: standalone`) and a service worker (`public/sw.js`) that shows the notification and opens the app on tap.
- An "Enable reminders" button. iOS only shows the permission prompt after a tap.
- `push_subscriptions`: the phone's push endpoint and keys. A subscription the push service rejects as expired is deleted, and the app asks to enable again.
- VAPID keys for signing pushes, in Vercel env vars (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), sent with the `web-push` package.
- `/api/cron/reminders`, guarded by `CRON_SECRET` like the health sync.
- A reminders toggle next to Goals, to turn them off without deleting the app.

**Never annoying.** At most one push a day, only at the set time, and no "you missed 3 days" messages.

## Schema

Added to `supabase/schema.sql` when built, idempotent like the rest:

```sql
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  entry_date date not null,
  kind text not null check (kind in ('morning', 'evening', 'other')),
  body text not null,
  mood smallint check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  stress smallint check (stress between 1 and 5),
  soreness smallint check (soreness between 1 and 5),
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  name text not null,
  measure text not null check (measure in ('intensity', 'count', 'minutes')),
  unit text,
  direction text not null check (direction in ('limit', 'build')),
  scale_guide text,
  cutoff time,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_name, name)
);

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  habit_id uuid not null references public.habits (id),
  entry_date date not null,
  amount numeric not null check (amount >= 0),
  details text,
  started_at time,
  ended_at time,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_name text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reminder_sends (
  user_name text not null,
  local_date date not null,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (user_name, local_date, kind)
);
```

Plus indexes on `(user_name, entry_date)` and row level security enabled, as for the other tables.

## Build order

1. Tables, habits seeded with the starting set, and the chat tools.
2. Today: timeline rows and the Check-in card.
3. Reminders: manifest, service worker, Enable button, cron route, VAPID keys in Vercel.

## Later

- Habit-vs-health comparisons on Today or their own tab, once there's enough data.
- The rolling stress signal from [mvp-plan.md](mvp-plan.md#ideas-for-later), from journal stress ratings and training load.
- A morning reminder, if the evening one works and he wants it.
