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
| Chest | (one muscle, not split) |
| Back | Lats, Upper Back (rhomboids, mid back), Traps, Lower Back |
| Shoulders | Front Delts, Side Delts, Rear Delts |
| Arms | Biceps, Triceps, Forearms |
| Legs | Quads, Hamstrings, Glutes, Calves |
| Core | Upper Abs, Lower Abs, Obliques |
| Cardio | |
| Mobility | |

`muscle_groups` stores a mix: a group name means the whole group (or unspecified), a muscle name means just that muscle, and a group is never stored alongside its own muscles (`normalizeMuscles`). Sessions logged before October 12, 2026 used Chest, Back, Shoulders, Biceps, Triceps, Legs, Abs and Cardio as groups; each of those is still a valid group or muscle, so old sessions read correctly with no data change. Core was Abs and Obliques until October 17, 2026; "Abs" in older sessions is a legacy name that counts for both Upper Abs and Lower Abs (`LEGACY_MUSCLES`). On the same day Chest stopped being split (Upper/Mid/Lower Chest now count as Chest). Traps moved from Shoulders to Back on October 17 and became their own Back muscle, apart from Upper Back, on October 19, 2026 (no stored session used Traps, so nothing needed migrating); Pull day includes them. Legacy names stay valid in stored sessions; the editor opens them as their current names, and the chat only uses current ones. Runs, rides and walks are Cardio; pilates is Core unless more is said; yoga and stretching are Mobility.

In the editor, tapping a group selects the whole group and shows its muscles; picking muscles narrows it, and unpicking the last one goes back to the whole group.

## Intensity, recovery and weekly volume

Each trained group or muscle is **light** (mostly stretching and light movement), **medium** (solid working sets) or **hard** (heavy or to failure). A name in `muscle_intensity` uses its own; otherwise its group's; otherwise the session RPE's (1–3 light, 4–6 medium, 7–10 hard, none medium). So "light chest and heavy tris" is one session, and extra moves worked into a workout ("light pushups after mobility") are just more muscles on it, not a separate tag. Stretching or mobility done inside a workout goes on that workout as Mobility rather than a session of its own.

| Intensity | Recovery | Volume points |
| --- | --- | --- |
| Light | 1 day (fine the next day) | 1 |
| Medium | 2–3 days (ready after 2) | 2 |
| Hard | 5–6 days (ready after 5) | 3 |

Weekly target: 4 points per muscle in any 7 days (today included): a hard and a light session, or two medium. **Getting every muscle to 4 is the tab's main goal**; everything else supports it. A session logged as a whole group counts for each of its muscles. `INTENSITY_RULES` and `WEEKLY_TARGET_POINTS` in `lib/workouts.ts`; `loadOf` gives a muscle's points and days until recovered, `bucketOf` puts it in **due** (short and ready), **recovering** (short, not ready) or **covered** (4 or more), and `weekStatus` sorts every strength muscle that way.

## Soreness

A small input, added October 19, 2026. Tapping a muscle on the body map can mark it **sore today, mild or bad** (`body_log`, kind `sore`; one report per muscle per day, and tapping the same one again removes it). Soreness only pushes back when a muscle is ready to train: a mild report holds it for the day it's made, a bad one for three days (`SORENESS_HOLD_DAYS`, first guesses to tune once there's history). It never changes weekly points, and a "feels fine" report can't make a muscle ready sooner: the owner chose that reports only add. Report it again to extend it. So a sore muscle that's short of 4 points shows as recovering, and Next up skips it.

`body_log` also has kind `pain` with plain body parts (wrist, lower back), from the body log plan in [journal-habits-plan.md](journal-habits-plan.md#planned-body-log-for-soreness-and-pain-agreed-october-17-2026-not-built). Nothing writes pain yet, and the chat can't log soreness yet (map only, for now).

## What the Training tab reads

From the top: **This week** (Next up, the body map, the due list), **Unlabeled** when there are any, **Last 14 days** (strength coverage and activity in one card), then **Recent workouts** by week.

- **Body map** (`app/body-map.tsx`): a schematic front and back figure with one shape per tracked muscle, shaded by its week: due in orange (darker at 0–1 points, lighter at 2–3), recovering in amber, covered in green. Tapping a muscle shows its points out of 4, days until ready, the sessions that counted (with their intensity and points) and any soreness, with **Sore today: Mild / Bad**.
- **Next up:** the strength day to do next (`recommendNext`): push, pull or legs, whichever has the most weekly volume missing from muscles that have recovered (longer gaps break ties, capped at 30 days), with the three ready muscles furthest below target, and "+ core" when core is ready and short. "Recover" when everything short is still recovering, "You're covered" when every split muscle has its weekly volume.
- **Due list:** under the map, the due muscles with their points, least first. Recovering and covered show on the map only. Progress bars were tried and dropped: on a rolling week they rarely look full.
- **Activity:** a 14-day grid of strength, cardio (run, walk, ride, class), mobility (pilates, yoga) and sport, from logged sessions and watch workouts (auto-detected walks left out), with counts per kind. Mobility is a category, not a type: the muscles can override the type (`activityCategoriesOf`). A session whose only muscle is Mobility is mobility whatever its type (a "core training" recording that was stretching), only Cardio is cardio, an "other" session with strength muscles is strength, and Mobility or Cardio inside another workout also counts for that kind on its day. Counts use the main kind.
- **Days since each muscle group was trained:** the latest session per group; a specific muscle counts for its group.
- **14-day strength coverage grid:** sessions per day for the six strength groups (Cardio and Mobility live in Activity), shaded light, medium or hard. A group row shows how much of the group was worked (`groupDayIntensity`): each muscle's points that day (its hardest; a whole-group session counts for all of them), averaged over the group's muscles and rounded to the nearest intensity, so one medium Side Delts set is a light Shoulders day. Tapping a group expands a row per specific muscle, shaded by the hardest that muscle got; sessions logged as the whole group shade only the group row. The old "sessions per muscle group" card was dropped as redundant. This replaces "hard sets per muscle group", which needs per-set data.
- **Recent workouts:** grouped by week (Monday to Sunday) with each week's count and minutes. Fitbit workouts (unlabeled walks left out) joined to their sessions for duration, heart rate and strain, plus sessions with no Fitbit link. Chips show muscles by group ("Shoulders: Side Delts, Rear Delts"). A filter row picks one workout type, with counts per type. Each logged one opens to edit its name, type ("Mixed / other" for a bit-of-everything session), muscles (optional), RPE and per-muscle intensity, or to delete it; deleting makes its Fitbit workout unlabeled again. Combined and overlapping watch recordings can be separated or merged ([workout-dedupe.md](workout-dedupe.md)).
- **Unlabeled workouts:** watch workouts whose name doesn't say what was trained (WEIGHTLIFTING, WEIGHTS, CORE_TRAINING, AEROBIC_WORKOUT) from the last 7 days with no session. Each can be labeled with **Label** (optional muscles with intensity, and RPE, saved straight away; the type is what the watch recorded, and the muscles decide whether it counts as strength, mobility or both) or **Chat** (opens chat with a sentence to finish). Any other unlabeled watch workout except walks has the same buttons in Recent workouts; it just isn't asked about. `listUnlabeledWorkouts` in `lib/workouts.ts`. **Ignore** sets one aside (an accidental 1-minute recording): it's saved in `workout_ignores` and left out of matching, Unlabeled, Recent workouts, Activity, the Today timeline and chat's unlabeled list. Day strain still counts it. "N ignored · Show" under Recent workouts lists them with **Restore**.
- Groups not trained in 7 or more days show in red in the coverage grid.

## Later: per-exercise sets

If set-level detail becomes worth typing, add an `exercises` catalog (name, aliases, primary and secondary muscles, equipment) and `workout_sets` (session, exercise, reps, weight, duration, RPE, warm-up flag), and restore "hard sets per muscle group". Sessions stay as they are; sets hang off them.

## Open questions

- Whether 7 days is the right threshold for "missing".
- Whether unlabeled Fitbit walks and golf should count as Cardio. They don't for now.
