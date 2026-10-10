# Chat brain

Status: built October 10, 2026, on branch `claude-brain-spike`. This is the contract between the chat sheet, `/api/brain` and Claude.

## How a turn runs

1. The chat sheet (`app/chat-sheet.tsx`) posts `{ message, date }` to `/api/brain`.
2. The route loads the current conversation's last 10 turns and any unsaved drafts from `chat_messages`, then calls `runBrain` (`lib/brain.ts`).
3. `runBrain` calls `runClaude` (`lib/claude-brain.ts`), which uses the Claude Agent SDK. The SDK starts the Claude Code binary, which signs in with `CLAUDE_CODE_OAUTH_TOKEN` (the owner's subscription; issue one with `claude setup-token`). It runs with our system prompt and our tools only: no built-in tools, no settings from disk, no saved sessions.
4. Claude answers in text and calls our tools. The tools run inside the same Vercel function, validate their input with Zod, and build drafts.
5. The route stores the user message and the reply (with its drafts) in `chat_messages` and returns them.
6. Nothing else is written until the owner taps **Save** on a draft (`saveDraftAction` in `app/actions.ts`), which saves the server's stored copy of the draft, never data from the browser.

Model: `claude-sonnet-5-5` at low effort, overridable with `CLAUDE_MODEL`. A turn takes about 5–15 seconds.

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

Claude remembers nothing between requests. Each turn it sees only what the route sends: the current conversation's last 10 messages, its unsaved drafts, and today's date and time. **New chat** (`newChatAction`) starts a fresh conversation; the old one stays in the database but isn't shown or sent. Long-term memory is the logged data itself, which Claude will read through tools.

## Tools

| Tool | Does |
| --- | --- |
| `draft_meal` | Creates or revises (`replaces: id`) a meal draft. One call per meal. |
| `draft_workout` | Creates or revises a workout draft and matches it to a Fitbit workout. One call per activity. |
| `list_fitbit_workouts` | Read-only: the watch's workouts in a date range (31 days at most), optionally only unlabeled ones. Used for backfill. |

Tools only build drafts. Read tools for meals, goals and health metrics come next; they plug into the same in-process server.

## Drafts

```ts
MealDraft = {
  type: "meal", id, date, raw_text,
  meal_type: "breakfast" | "lunch" | "dinner" | "snack",
  estimate: ParsedMacros,      // same shape as the meal logger; totals summed from items in code
  saved_id: string | null,     // macro_entries.id once saved
  discarded?: boolean
}

WorkoutDraft = {
  type: "workout", id, date, raw_text,
  name,                        // "Chest + Triceps"
  workout_type: "strength" | "run" | "walk" | "ride" | "sport" | "class" | "other",
  muscle_groups: ("Chest" | "Back" | "Shoulders" | "Biceps" | "Triceps" | "Legs" | "Abs" | "Cardio")[],
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

1. Candidates are that day's Fitbit workouts of a fitting type that no session or other open draft has claimed. Types map as: strength → WEIGHTLIFTING, WEIGHTS, CORE_TRAINING, AEROBIC_WORKOUT; sport → TENNIS, GOLF, SPORT; class → PILATES, YOGA, AEROBIC_WORKOUT; run, walk and ride to their own types.
2. A time hint narrows to workouts overlapping the window (±15 minutes).
3. Same-day logs with no hint prefer the workout that most recently ended before the message.
4. One candidate left is `matched`; several is `ambiguous` with a best guess. The card's **Change** picker lists the rest, plus "link it later".
5. Nothing found today: the brain runs an exercise-only health sync once and tries again.
6. Saved without a link, a session is `pending`. After every sync that includes exercise, `autoLinkPendingSessions` links pending sessions that have exactly one candidate. Ambiguous ones stay pending.

Tested against the Fitbit history (June–October 2026): with the type filter, 43 of 45 lifting days have a single candidate, and sport, class and run days always do.

**Backfill.** Drafts carry their own date, so "label last week: Monday chest and tris hard, Wednesday legs" makes one draft per day, each matched on its own date. Claude can call `list_fitbit_workouts` and pass `fitbit_workout_id` when a description clearly points at one workout ("the 6 pm lift on Tuesday").

## Tables

`supabase/schema.sql` has the definitions.

- `chat_conversations`: one row per conversation; the latest is current.
- `chat_messages`: the messages, each in a conversation. Assistant rows carry their drafts in `drafts` (JSONB).
- `workout_sessions`: one row per logged workout. `match_status` is `linked` (with `health_record_key`), `pending` or `untracked`. A unique index stops one Fitbit workout from being linked twice.
- `macro_entries.meal_type`: set for meals saved from chat.

## Trying it

- `npm run brain -- "chest and tris, hard"` runs one turn in the terminal. It reads the database but writes nothing: no chat rows, no sync. Add `--date YYYY-MM-DD` to log against another day.
- `npm run dev`, then tap **Log** on any tab.
