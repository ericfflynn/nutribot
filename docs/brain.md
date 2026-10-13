# Chat brain

Status: in production since October 10, 2026. This is the contract between the chat (the Chat tab and the floating sheet), `/api/brain` and Claude.

## How a turn runs

1. The chat sheet (`app/chat-sheet.tsx`) posts `{ message, date }` to `/api/brain`.
2. The route loads the current conversation's last 10 turns and any unsaved drafts from `chat_messages`, then calls `runBrain` (`lib/brain.ts`).
3. `runBrain` calls `runClaude` (`lib/claude-brain.ts`), which uses the Claude Agent SDK. The SDK starts the Claude Code binary, which signs in with `CLAUDE_CODE_OAUTH_TOKEN` (the owner's subscription; issue one with `claude setup-token`). It runs with our system prompt and our tools only: no built-in tools, no settings from disk, no saved sessions.
4. Claude answers in text and calls our tools. The tools run inside the same Vercel function, validate their input with Zod, and build drafts.
5. The route stores the user message and the reply (with its drafts) in `chat_messages` and returns them.
6. Nothing else is written until the owner taps **Save** (or **Update**, for an edit) on a draft (`saveDraftAction` in `app/actions.ts`), which saves the server's stored copy of the draft, never data from the browser.

Model: `claude-sonnet-5-5` at low effort, overridable with `CLAUDE_MODEL`. A turn takes about 5–15 seconds.

## Running in production

- **Token.** `CLAUDE_CODE_OAUTH_TOKEN` is set in Vercel for Production and Preview (sensitive). `claude setup-token` issues one that lasts about a year. When it expires the chat answers with an error; issue a new one and run `vercel env add CLAUDE_CODE_OAUTH_TOKEN production,preview --sensitive --force`, then redeploy. Never set `ANTHROPIC_API_KEY` there: it outranks the token and bills per token.
- **Usage.** Every turn counts against the owner's Claude plan limits, the same pool as Claude Code.
- **Function size.** The SDK runs the Claude Code binary (about 260 MB), over Vercel's standard 250 MB function limit. `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` (Production and Preview) turns on large functions, and `next.config.ts` keeps the SDK unbundled and ships the Linux binary with `/api/brain` (`outputFileTracingIncludes`). A new route that calls Claude needs its own entry there.
- **Latency.** A turn is about 3–15 seconds, a few more on a cold start. The route allows 300 seconds, the Hobby maximum.
- **Testing a preview.** Previews sit behind Vercel's deployment protection; `vercel curl /api/brain --deployment <url> -- ...` gets through it. The route still needs a session cookie.

## Request and response

`POST /api/brain`

```ts
// request
{ message: string, date: "YYYY-MM-DD" }   // date: the day on screen, the default for drafts

// response
{
  message_id: string,                     // the assistant row in chat_messages
  reply: string,                          // plain text for the thread
  drafts: Draft[],
  meta: { model: string, durationMs: number, turns: number }
}
```

`GET /api/brain` returns the current conversation's last 40 messages: `{ messages: { id, role, content, drafts, createdAt }[] }`.

## Memory

Claude remembers nothing between requests. Each turn it sees only what the route sends: the current conversation's last 10 messages, its unsaved drafts, and today's date and time. **New chat** (`newChatAction`) starts a fresh conversation; the old one stays in the database but isn't shown or sent. Long-term memory is the logged data itself, which Claude reads through its list tools and `get_goals`.

## Tools

| Tool | Does |
| --- | --- |
| `draft_meal` | Creates or revises (`replaces: id`) a meal draft. One call per meal. With `edits: <macro_entries.id>` the draft corrects that saved meal instead: saving it overwrites the meal's text, items, macros, type, day and time. `eaten_at` (local `HH:MM`) is when it was eaten, for meals logged late or to move one on Today's timeline; left out, it carries over from the draft or saved meal. |
| `draft_workout` | Creates or revises a workout draft and matches it to a Fitbit workout. One call per activity. |
| `list_meals` | Read-only: saved meals in a date range, newest first, at most 40, with ids, totals and each item's macros and portion. `search` keeps meals whose text or item names contain every word, and allows ranges up to 365 days (31 without). The prompt has Claude search past meals before estimating one, and reuse a matching meal's items and macros, since the owner repeats meals often. Also how Claude finds a saved meal to edit. |
| `get_goals` | Read-only: daily targets (calories, macros in grams and percent, water oz) and one day's saved totals against them (`target`, `done`, `left`). Open drafts aren't counted. Goals are changed in the Goals panel on Today, not through chat. |
| `draft_journal` | A journal entry draft: kind (morning, evening, other), body in their words, ratings, tags. Mood (1 Very low – 5 Excellent) is the main rating; stress (1 None / relaxed – 5 Overwhelming), energy and soreness are optional. Each is null when unsaid, and stress is never derived from mood or the other way round. Tags are normalized in code (`normalizeTags` in `lib/journal-tags.ts`) against a categorized vocabulary and the owner's earlier tags. |
| `draft_habits` | One card with a day's habit logs: each use (intensity 1–3, count or minutes, details, optional start and end times) and each explicit zero. The result lists active habits not logged yet that day, so Claude can ask. |
| `draft_habit` | Adds a tracked habit or changes one: name, description, measure, direction, scale guide (required for intensity), goal, cutoff, days tracked, archived. A change keeps the habit's logs; the measure can't change once a habit has logs. The owner can also edit habits on the Habits tab. |
| `list_habits`, `list_journal`, `list_habit_logs` | Read-only: tracked habits with descriptions, days and scale guides; journal entries with labeled ratings and tags; each day's habit status (level, uses, minutes past cutoff, unlogged, or not tracked that day). Ranges up to 92 days. |
| `get_health` | Read-only (`lib/brain-health.ts`): watch data for up to 366 days, one line per day with sleep (duration, stages, bed and wake), HRV, resting HR, SpO2, breathing rate, VO2 max, skin temperature vs baseline, steps, active kcal, zone minutes, the app's Sleep / Recovery / Strain scores and that day's watch workouts, then averages over the full days in the range. |
| `list_workouts` | Read-only: workouts in a date range (31 days at most), newest first. Each watch workout comes with what it was logged as (name, type, muscles, RPE) and how many duplicate watch recordings it combines ([workout-dedupe.md](workout-dedupe.md)), plus logged sessions with no watch workout; optionally only unlabeled watch workouts. Used for backfill, check-ins and questions about recent training. |

| `draft_feedback`, `list_feedback` | Queues a bug, change or idea about the app itself (one draft per item, saved to `app_feedback` on Save) for the next dev pass, or changes a saved one (`feedback_id`): rewording, or marking it done or dropped. Items are never deleted. `list_feedback` lists the queue with ids. `lib/feedback.ts`. |

Tools only build drafts; the rest only read.

## Drafts

```ts
MealDraft = {
  type: "meal", id, date, raw_text,
  meal_type: "breakfast" | "lunch" | "dinner" | "snack" | "dessert",
  eaten_at?: string | null,    // local "HH:MM" eaten; null places it at the save time
  estimate: ParsedMacros,      // same shape as the meal logger; totals summed from items in code
  edits?: { id, date, meal_type, calories, eaten_at } | null,  // the saved meal this corrects, as it was
  saved_id: string | null,     // macro_entries.id once saved (the edited meal's id for an edit)
  discarded?: boolean
}

WorkoutDraft = {
  type: "workout", id, date, raw_text,
  name,                        // "Chest + Triceps"
  workout_type: "strength" | "run" | "walk" | "ride" | "sport" | "pilates" | "yoga" | "class" | "other",
  muscle_groups: MuscleName[], // groups ("Shoulders") and specific muscles ("Rear Delts"); see training-plan.md
  rpe: number | null,          // 1–10; "easy" 3–4, "hard" 8, "all-out" 9–10
  duration_min: number | null, // only for untracked workouts
  time_hint: { start: "HH:MM", end: "HH:MM" } | null,
  untracked: boolean,          // "forgot my watch"
  notes, questions[],          // the only question asked is how hard it was
  match: { status: "matched" | "ambiguous" | "none", match: FitbitWorkout | null, alternatives: FitbitWorkout[] },
  linked_by: "auto" | "user" | null,
  saved_id: string | null,     // workout_sessions.id once saved
  discarded?: boolean
}
```

A draft revised in a later reply keeps its id, so the sheet shows only the latest version. Drafts from the last three replies stay revisable.

## Matching workouts to Fitbit

Claude supplies the clues: type, date, an optional time window, and whether the watch was worn. `chooseMatch` in `lib/workouts.ts` does the matching:

1. Candidates are that day's Fitbit workouts of a fitting type that no session or other open draft has claimed. Types map as: strength → WEIGHTLIFTING, WEIGHTS, CORE_TRAINING, AEROBIC_WORKOUT; sport → TENNIS, GOLF, SPORT; pilates → PILATES; yoga → YOGA; class → AEROBIC_WORKOUT, PILATES, YOGA; run, walk and ride to their own types. Candidates come from `health_workouts`, so duplicate recordings never compete with each other.
2. A time hint narrows to workouts overlapping the window (±15 minutes).
3. Same-day logs with no hint prefer the workout that most recently ended before the message.
4. One candidate left is `matched`; several is `ambiguous` with a best guess. The card's **Change** picker lists the rest, plus "link it later".
5. Nothing found today: the brain runs an exercise-only health sync once and tries again.
6. Saved without a link, a session is `pending`. After every sync that includes exercise, `autoLinkPendingSessions` links pending sessions that have exactly one candidate. Ambiguous ones stay pending.

Tested against the Fitbit history (June–October 2026): with the type filter, 43 of 45 lifting days have a single candidate, and sport, class and run days always do.

**Backfill.** Drafts carry their own date, so "label last week: Monday chest and tris hard, Wednesday legs" makes one draft per day, each matched on its own date. Claude can call `list_workouts` and pass `fitbit_workout_id` when a description clearly points at one workout ("the 6 pm lift on Tuesday").

## Tables

`supabase/schema.sql` has the definitions.

- `chat_conversations`: one row per conversation; the latest is current.
- `chat_messages`: the messages, each in a conversation. Assistant rows carry their drafts in `drafts` (JSONB).
- `workout_sessions`: one row per logged workout. `match_status` is `linked` (with `health_record_key`), `pending` or `untracked`. A unique index stops one Fitbit workout from being linked twice.
- `macro_entries.meal_type`: set for meals saved from chat.

## Trying it

- `npm run brain -- "chest and tris, hard"` runs one turn in the terminal. It reads the database but writes nothing: no chat rows, no sync. Add `--date YYYY-MM-DD` to log against another day.
- `npm run dev`, then tap **Chat** on any tab.
