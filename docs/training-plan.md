# Training data plan

Status: proposed October 9, 2026. Nothing here is built yet. It extends the `logWorkout` tool in [mvp-plan.md](mvp-plan.md).

Design: the "Training tab" artboard in the Today redesign mockup, https://claude.ai/artifact/EhsjJ6o5xx4eXhnrBV1xaG (private to the owner). Build the tab to match it: Missing callout, 14-day coverage grid, hard sets per muscle group, recent workouts with a movements table.

## Goal

Record every workout down to the movements, sets and intensity, so the Training tab (and the assistant) can look back over the last couple of weeks and say what's been missed: "back and biceps haven't been trained in 11 days."

Fitbit already gives us each workout's time, type, heart rate, calories and strain (`health_workouts` view). It knows nothing about what was lifted. The tables below hold that part and link to the Fitbit workout when there is one.

## Tables

### `workout_sessions`

One row per workout, whether Fitbit saw it or not.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key. |
| `user_name` | text | Scoped like every other table. |
| `entry_date` | date | Local calendar date. |
| `started_at` | timestamptz | Null if only the day is known. |
| `name` | text | "Strength · Lower", "Run". |
| `kind` | text | `strength`, `run`, `walk`, `ride`, `class`, `other`. |
| `health_record_key` | text | Nullable. The matching Fitbit workout (`health_workouts.id`). Unique per user when set. |
| `rpe` | numeric | Optional overall effort, 1–10. |
| `muscle_tags` | text[] | Only for workouts without logged sets (a class, a hike). Otherwise tags come from the sets. |
| `notes` | text | |
| `created_at` | timestamptz | |

### `exercises`

A shared catalog of movements and the muscles they work. Seeded with common lifts; the assistant adds new rows when it meets a movement it doesn't know, and asks which muscles it works if that isn't obvious.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `name` | text | Unique, canonical: "Romanian deadlift". |
| `aliases` | text[] | "RDL", "romanian dl". Used to match chat input. |
| `primary_muscles` | text[] | From the muscle group list below. |
| `secondary_muscles` | text[] | Counted at half a set in volume totals. |
| `equipment` | text | `barbell`, `dumbbell`, `machine`, `cable`, `bodyweight`, `other`. |

### `workout_sets`

One row per set.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `session_id` | uuid | References `workout_sessions`, cascade delete. |
| `exercise_id` | uuid | References `exercises`. |
| `position` | int | Order within the session. |
| `reps` | int | Null for timed sets. |
| `weight_lb` | numeric | Null for bodyweight. Total load (both dumbbells). |
| `duration_s` | int | For planks, carries, intervals. |
| `rpe` | numeric | Optional, 1–10. |
| `is_warmup` | boolean | Default false. Warm-ups don't count toward volume. |

## Muscle groups

Starting list, matching the Training tab mockup: Chest, Back, Shoulders, Biceps, Triceps, Legs, Abs, Cardio. Legs may later split into quads, hamstrings, glutes and calves; the catalog can carry the finer names and the tab can roll them up.

## How a workout gets logged

1. In chat: "legs today: squat 4x6 at 225, RDL 3x8 at 185, leg raises 3x12".
2. `logWorkout` matches each movement to `exercises` (name or alias), asks about anything it can't match, and validates the sets with Zod.
3. It creates the session and its sets in one transaction, then says "logged" only after the write succeeds (the MVP write rules).
4. It links the session to a Fitbit workout on the same day whose time overlaps, or links it later when the sync brings that workout in. Heart rate and strain keep coming from Fitbit.

## What the Training tab reads

- **Days since each muscle group was trained:** the latest session per muscle, from set muscles or `muscle_tags`.
- **14-day coverage grid:** sessions per day per muscle group.
- **Hard sets per muscle group:** working sets (not warm-ups) over 14 days, primary muscles counted once and secondary muscles counted as half.
- **Recent workouts:** sessions with their sets, joined to Fitbit for duration, heart rate and strain.
- **Gaps:** muscle groups not trained in 7 or more days. The assistant reads the same query to suggest the next session.

## Open questions

- Whether 7 days is the right threshold for "missing".
- Pounds only, or store kilograms too.
- Whether to keep a simple per-session `muscle_tags` override even when sets are logged.
