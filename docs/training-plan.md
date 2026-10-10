# Training data plan

Status: revised October 10, 2026. Session-level logging is built (branch `claude-brain-spike`, see [brain.md](brain.md)); the Training tab is not. Per-exercise sets are deferred.

Design: the "Training tab" artboard in the Today redesign mockup, https://claude.ai/artifact/EhsjJ6o5xx4eXhnrBV1xaG (private to the owner). Build the tab to match it, with the changes below.

## Goal

Know which muscle groups were trained, when, and how hard, so the Training tab (and the assistant) can say what's been missed: "back and biceps haven't been trained in 11 days."

Fitbit already records each workout's time, type, heart rate, calories and strain (`health_workouts` view), but nothing about what was trained. Logging is deliberately light: "chest and tris, hard" in chat. Claude turns that into muscle groups and an RPE, and the app links it to the Fitbit workout.

## `workout_sessions`

One row per logged workout, whether Fitbit saw it or not. Definition in `supabase/schema.sql`.

| Column | Notes |
| --- | --- |
| `entry_date` | Local calendar date. |
| `name` | "Chest + Triceps". |
| `workout_type` | `strength`, `run`, `walk`, `ride`, `sport`, `class`, `other`. |
| `muscle_groups` | From the list below. |
| `rpe` | Overall effort, 1–10, from words ("hard" is 8) or a number. |
| `duration_min` | Only for untracked workouts; tracked ones use Fitbit's duration. |
| `match_status` | `linked`, `pending` (waiting for the watch to sync) or `untracked` (watch not worn). |
| `health_record_key` | The linked `health_workouts.id`. Unique per user. |
| `linked_by` | `auto` (the matcher) or `user` (picked in the card or named in chat). |
| `time_hint_start`, `time_hint_end` | Local window from "this morning", used when matching later. |
| `raw_text`, `notes` | What was written, and an optional note. |

Matching rules are in [brain.md](brain.md#matching-workouts-to-fitbit).

## Muscle groups

Chest, Back, Shoulders, Biceps, Triceps, Legs, Abs, Cardio. Runs, rides and walks count as Cardio.

## What the Training tab reads

- **Days since each muscle group was trained:** the latest session per muscle group.
- **14-day coverage grid:** sessions per day per muscle group, shaded by RPE. This replaces "hard sets per muscle group", which needs per-set data.
- **Recent workouts:** sessions joined to Fitbit for duration, heart rate and strain.
- **Unlabeled workouts:** Fitbit lifting, sport and class workouts with no session (walks excluded), each with a "What did you train?" prompt that opens chat. `listUnlabeledWorkouts` in `lib/workouts.ts`.
- **Gaps:** muscle groups not trained in 7 or more days.

## Later: per-exercise sets

If set-level detail becomes worth typing, add an `exercises` catalog (name, aliases, primary and secondary muscles, equipment) and `workout_sets` (session, exercise, reps, weight, duration, RPE, warm-up flag), and restore "hard sets per muscle group". Sessions stay as they are; sets hang off them.

## Open questions

- Whether 7 days is the right threshold for "missing".
- Whether golf and walks should count as Cardio on the coverage grid.
