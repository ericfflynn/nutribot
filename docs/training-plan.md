# Training data plan

Status: in production since October 10, 2026: session-level logging through chat ([brain.md](brain.md)) and the Training tab (`app/training/page.tsx`). Per-exercise sets are deferred.

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
| `workout_type` | `strength`, `run`, `walk`, `ride`, `sport`, `pilates`, `yoga`, `class` (spin, aerobics, other classes), `other`. Pilates and yoga became their own types on October 12, 2026; earlier ones stay `class`. |
| `muscle_groups` | Group names and specific muscles, from the list below. |
| `rpe` | Overall effort, 1–10, from words ("hard" is 8) or a number. |
| `muscle_intensity` | JSONB, `{"Chest": "light"}`: intensity for names in `muscle_groups` that differ from the RPE. Added October 17, 2026; older sessions are `{}`. |
| `duration_min` | Only for untracked workouts; tracked ones use Fitbit's duration. |
| `match_status` | `linked`, `pending` (waiting for the watch to sync) or `untracked` (watch not worn). |
| `health_record_key` | The linked `health_workouts.id`. Unique per user. |
| `linked_by` | `auto` (the matcher) or `user` (picked in the card or named in chat). |
| `time_hint_start`, `time_hint_end` | Local window from "this morning", used when matching later. |
| `raw_text`, `notes` | What was written, and an optional note. |

Matching rules are in [brain.md](brain.md#matching-workouts-to-fitbit).

## Muscle groups

Picked group first, then specific muscles (`MUSCLES` in `lib/workouts.ts`):

| Group | Muscles |
| --- | --- |
| Chest | Upper Chest, Mid Chest, Lower Chest |
| Back | Lats, Upper Back, Lower Back |
| Shoulders | Front Delts, Side Delts, Rear Delts, Traps |
| Arms | Biceps, Triceps, Forearms |
| Legs | Quads, Hamstrings, Glutes, Calves |
| Core | Upper Abs, Lower Abs, Obliques |
| Cardio | |
| Mobility | |

`muscle_groups` stores a mix: a group name means the whole group (or unspecified), a muscle name means just that muscle, and a group is never stored alongside its own muscles (`normalizeMuscles`). Sessions logged before October 12, 2026 used Chest, Back, Shoulders, Biceps, Triceps, Legs, Abs and Cardio as groups; each of those is still a valid group or muscle, so old sessions read correctly with no data change. Core was Abs and Obliques until October 17, 2026; "Abs" in older sessions is a legacy name that counts for both Upper Abs and Lower Abs (`LEGACY_MUSCLES`). Runs, rides and walks are Cardio; pilates is Core unless more is said; yoga and stretching are Mobility.

In the editor, tapping a group selects the whole group and shows its muscles; picking muscles narrows it, and unpicking the last one goes back to the whole group.

## Intensity, recovery and weekly volume

Each trained group or muscle is **light** (mostly stretching and light movement), **medium** (solid working sets) or **hard** (heavy or to failure). A name in `muscle_intensity` uses its own; otherwise its group's; otherwise the session RPE's (1–3 light, 4–6 medium, 7–10 hard, none medium). So "light chest and heavy tris" is one session, and extra moves worked into a workout ("light pushups after mobility") are just more muscles on it, not a separate tag. Stretching or mobility done inside a workout goes on that workout as Mobility rather than a session of its own.

| Intensity | Recovery | Volume points |
| --- | --- | --- |
| Light | 1 day (fine the next day) | 1 |
| Medium | 2–3 days (ready after 2) | 2 |
| Hard | 5–6 days (ready after 5) | 3 |

Weekly target: 4 points per muscle in any 7 days (today included): a hard and a light session, or two medium. A session logged as a whole group counts for each of its muscles. `INTENSITY_RULES` and `WEEKLY_TARGET_POINTS` in `lib/workouts.ts`; `loadOf` gives a muscle's points and days until recovered, `weekStatus` sorts every strength muscle into due, recovering or covered.

## What the Training tab reads

- **Next up:** the strength day to do next (`recommendNext`): push, pull or legs, whichever has the most weekly volume missing from muscles that have recovered (longer gaps break ties, capped at 30 days), with the three ready muscles furthest below target, and "+ core" when core is ready and short. "Recover" when everything short is still recovering, "You're covered" when every split muscle has its weekly volume.
- **This week:** every strength muscle in one of three buckets: **Due** (recovered and under 4 points, least first, with its points), **Recovering** (under 4 but not ready, with days left) and **Covered** (4 or more). Progress bars were tried and dropped: on a rolling week they rarely look full.
- **Activity:** a 14-day grid of strength, cardio (run, walk, ride, class), mobility (pilates, yoga) and sport, from logged sessions and watch workouts (auto-detected walks left out), with counts per kind. Mobility is a category, not a type: the muscles can override the type (`activityCategoriesOf`). A session whose only muscle is Mobility is mobility whatever its type (a "core training" recording that was stretching), only Cardio is cardio, an "other" session with strength muscles is strength, and Mobility or Cardio inside another workout also counts for that kind on its day. Counts use the main kind.
- **Days since each muscle group was trained:** the latest session per group; a specific muscle counts for its group.
- **14-day strength coverage grid:** sessions per day for the six strength groups (Cardio and Mobility live in Activity), shaded light, medium or hard (the hardest that day). Tapping a group expands a row per specific muscle; sessions logged as the whole group shade only the group row. The old "sessions per muscle group" card was dropped as redundant. This replaces "hard sets per muscle group", which needs per-set data.
- **Recent workouts:** Fitbit workouts (unlabeled walks left out) joined to their sessions for duration, heart rate and strain, plus sessions with no Fitbit link. Chips show muscles by group ("Shoulders: Side Delts, Rear Delts"). A filter row picks one workout type, with counts per type. Each logged one opens to edit its name, type ("Mixed / other" for a bit-of-everything session), muscles (optional), RPE and per-muscle intensity, or to delete it; deleting makes its Fitbit workout unlabeled again. Combined and overlapping watch recordings can be separated or merged ([workout-dedupe.md](workout-dedupe.md)).
- **Unlabeled workouts:** watch workouts whose name doesn't say what was trained (WEIGHTLIFTING, WEIGHTS, CORE_TRAINING, AEROBIC_WORKOUT) from the last 7 days with no session. Each can be labeled with **Label** (optional muscles with intensity, and RPE, saved straight away; the type is what the watch recorded, and the muscles decide whether it counts as strength, mobility or both) or **Chat** (opens chat with a sentence to finish). Any other unlabeled watch workout except walks has the same buttons in Recent workouts; it just isn't asked about. `listUnlabeledWorkouts` in `lib/workouts.ts`. **Ignore** sets one aside (an accidental 1-minute recording): it's saved in `workout_ignores` and left out of matching, Unlabeled, Recent workouts, Activity, the Today timeline and chat's unlabeled list. Day strain still counts it. "N ignored · Show" under Recent workouts lists them with **Restore**.
- Groups not trained in 7 or more days show in red in the coverage grid.

## Later: per-exercise sets

If set-level detail becomes worth typing, add an `exercises` catalog (name, aliases, primary and secondary muscles, equipment) and `workout_sets` (session, exercise, reps, weight, duration, RPE, warm-up flag), and restore "hard sets per muscle group". Sessions stay as they are; sets hang off them.

## Open questions

- Whether 7 days is the right threshold for "missing".
- Whether unlabeled Fitbit walks and golf should count as Cardio. They don't for now.
