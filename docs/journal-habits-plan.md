# Journal, habits and reminders plan

Status: built October 10, 2026 (journal, habits, Habits tab, reminders). Upgraded October 12, 2026: mood first with optional stress, categorized tags with filters, editing habits and their entries, habit frequency, configurable reminders with snooze, conversational check-ins.

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
| `mood` | The main rating, 1–5: Very low, A little down, Neutral / okay, Good, Excellent. |
| `stress` | Optional, 1–5: None / relaxed, Mild, Moderate, High, Overwhelming. Pressure or strain, not mood. |
| `energy`, `soreness` | Optional, 1–5. |
| `tags` | One to four tags for what came up, normalized (see Tags). |

Every rating is null when unrecorded, never 0, and Claude never derives stress from mood or mood from stress: they stay separate for later correlation. Labels show next to the numbers everywhere ("Mood 4 · Good").

### Tags

`lib/journal-tags.ts` holds a small vocabulary in categories: Work, Relationships, Health, Exercise, Sleep, Social, Personal Growth, Other. Claude prefers those tags and adds a custom one only for something specific ("sore legs"). Every tag is normalized on save and on read (lowercase, no `#`, synonyms such as "bad sleep" → "poor sleep", plurals folded onto known tags), so variants count as one. Custom tags fall into a category by keyword.

The Journal card on the Habits tab loads 90 days, shows tags grouped by category with counts, and filters by a tag. With a tag picked, it shows average mood and stress with that tag against the rest. Each entry opens to fix its mood, stress and tags (picked by category or typed); the text stays as written.
| `created_at` | When it was saved. |

The morning prompt leans toward sleep and soreness; the evening one toward the day, stress and habits.

### Planned: key:value tags (agreed October 17, 2026, not built)

Free tags drifted (28 entries, 28 different tags, many repeating data the app already has). They become structured `key:value` pairs so trends can be read per key ("every `work:` day") and per value ("`work:deadline` days").

| Key | Starter values |
| --- | --- |
| `work` | deadline, meetings, focused, busy, slow, off |
| `social` (friends) | friends, party, hosting, game night |
| `relationship` | date, quality time, conflict, apart |
| `family` | visit, call, conflict |
| `health` | sick, headache, doctor, plus one-off symptoms |
| `leisure` | reading, tv, outdoors, gaming, golf |
| `stressor` | money, errands, plans, news |

- Keys are fixed; chat never invents one. Values come from the list or the owner's earlier values for that key; a one-off value is fine but always sits under a key (`health:canker sore`).
- No numbers: a tag is a key and a word.
- Tags stay neutral. How the day felt comes from the journal's mood and stress ratings, so trends read "mood on `family:visit` days".
- No tags for what other data already covers: workouts, sleep, drinks. Soreness and pain move to the body log below.
- The existing entries get mapped into the new keys; the "sore X" tags become body log entries.

### Planned: body log for soreness and pain (agreed October 17, 2026, not built)

One simple log, logged through chat (a card to Save, like everything else): a body part, **sore** or **pain**, and **mild** or **bad**, on a date. Soreness uses the Training muscle names; pain uses plain body parts (wrist, lower back) for recurring problems and injuries. The point is looking back: "wrist pain 6 times since August, mostly after push days". Later, and deliberately not designed yet: soreness and pain feed recovery and Next up on the Training tab.

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
| `description` | Optional: what counts, in his words. |
| `days` | Frequency: the weekdays it's tracked (0 Sunday–6 Saturday), null for every day. An unlogged day off is "off", not missed; a build habit done on a day off counts as met. |

Habits are edited on the Habits tab (Edit on each tracked habit) or through chat. Logs belong to the habit's id, so a rename or new goal keeps history. The measure can't change once a habit has logs. Stopped habits sit under "Stopped tracking" with Track again.

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

- Check-in card: today's mood first, with labels, and a Check in button.
- The 14-day grid, colored by outcome (days off the habit's frequency are outlined). Tapping a square opens that habit and day below the grid, to log a use, a "none", or edit or remove an entry (amount, day, note, times; edited in place, so no duplicates); tapping a name opens today. Intensity habits log with one tap (None, Light, Moderate, Heavy); drinks with a counter; minutes with optional start and end times.
- Journal history, tracked habits with their goals and scale guides, and the Reminders switch.

## On Today

- Journal entries and habit uses appear as timeline rows at the time they were saved; tapping a journal row shows the text.
- A small Check-in card: today's ratings, and which habits are logged, zero, or unknown.
- Trends that compare habits with sleep and recovery come later, once there are 3–4 weeks of data.

## Check-ins

A check-in is a short chat, not a form, and nothing is required. Started with no details ("Evening check-in", or from a reminder), Claude reads today's habit logs and workouts, then asks one friendly question covering what's missing: mood (morning: sleep), habits tracked today with no log, an unlabeled workout. From the answer it drafts the journal entry, the day's habits and any workout together. It may ask about mood once if still unclear, never about stress, energy or soreness, and may close with one line of pattern or streak.

## Reminders

iPhone web push to the Home Screen app (iOS 16.4+; it does not work in a Safari tab).

**Rows, not code.** `reminders` holds each reminder: kind, hour (local), days, optional message, on/off, snooze and today's dismissal. Kinds (`lib/reminder-rules.ts`):

| Kind | Says | Quiet when |
| --- | --- | --- |
| `checkin` | "How was today?" plus habits not logged | journaled and every habit tracked today logged |
| `journal` | "Take a minute to journal." | journaled |
| `habits` | "Not logged yet: …" | every habit tracked today logged |
| `habit` | "Log Reading for today?" (one per habit, set from the habit editor) | that habit logged |
| `custom` | its message | never |

Migrated October 12, 2026 to two rows reproducing the old behavior: "8 pm: Xbox off" (custom, Sun–Thu) and a check-in at 8 pm every day.

**Schedule.** Hobby cron runs each job once a day, so `vercel.json` has 24 jobs, one per UTC hour, all hitting `/api/cron/reminders`. Each run sends what's due in the current hour of `APP_TIME_ZONE`; Vercel fires anywhere in the hour. Everything due in one run goes out as a single notification. `reminder_sends` records each reminder's send per local day (kind = reminder id), so nothing fires twice.

**Snooze and dismiss.** Tapping a notification opens the chat with "Evening check-in" ready and a bar to Snooze 1 hr or mark Done for today. The Habits tab's Reminders card shows each reminder's status today with the same buttons, and edits reminders. A snooze fires on the first hourly run after it ends; a dismissal silences that reminder until tomorrow.

**Pieces.** Manifest (`app/manifest.ts`) and service worker (`public/sw.js`); the push switch per phone in the Reminders card; `push_subscriptions` (expired ones are deleted); VAPID keys in Vercel env vars sent with `web-push`; `/api/cron/reminders` guarded by `CRON_SECRET` (`?force=1` sends every enabled reminder now).

**Never annoying.** Nothing for things already logged, one notification per hour at most, no "you missed 3 days" messages.

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
