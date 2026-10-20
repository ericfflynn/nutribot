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

From the top: **This week** (Next up, the body map, the due list), **Unlabeled** when there are any, **Week by week** (one grid per 7 days, swiped back), then **Recent workouts** (last 14 days) by week.

- **Body map** (`app/body-map.tsx`): front and back figures drawn from [MuscleMap](https://github.com/melihcolpan/MuscleMap)'s male artwork (MIT, notice kept in `app/body-map-paths.ts`). Each tracked muscle is grey when ready and red when it isn't, light with a day to go and deep after a hard session today (`fatigueLevel`: days until ready over 5); soreness counts through those days. The rest of the body stays grey. Our muscles map onto its regions: rhomboids and rotator cuff are Upper Back, its "upper back" region is Lats, the trapezius pieces are Traps, and its outer deltoid is Side Delts. Tapping a muscle shows its points out of 4 and its bucket, how long until it's ready, the sessions that counted (with their intensity and points) and any soreness, with **Sore today: Mild / Bad**. A first schematic version with traffic-light colors per bucket was dropped as cheap-looking; red reads as sore, so color shows fatigue and the 4-point target lives in the due list and the tap panel.
- **Split line:** under Next up, the kinds of training short of their weekly target ("Split: cardio 1/2 this week"), or "on track". See the week grid below.
- **Next up:** the strength day to do next (`recommendNext`): push, pull or legs, whichever has the most weekly volume missing from muscles that have recovered (longer gaps break ties, capped at 30 days), with the three ready muscles furthest below target, and "+ core" when core is ready and short. "Recover" when everything short is still recovering, "You're covered" when every split muscle has its weekly volume.
- **Due list:** under the map, the due muscles with their points, least first. The rest show their points in the tap panel and the week grid. Progress bars were tried and dropped: on a rolling week they rarely look full.
- **Week by week:** one grid per rolling 7 days (the newest is the same window as the 4-point target), swiped sideways back to the first week with a logged session, at most 8. Rows: the six strength groups. Cells are shaded light, medium or hard in the body map's reds. A group's cell shows how much of the group was worked (`groupDayIntensity`): each muscle's points that day (its hardest; a whole-group session counts for all of them), averaged over the group's muscles and rounded to the nearest intensity, so one medium Side Delts set is a light Shoulders day. Tapping a group expands a row per muscle, shaded by the hardest that muscle got; sessions logged as the whole group shade only the group row. The right column is that week's progress, green at target: each muscle as points out of 4 (what session closes it), each group as a percent of 4 points per muscle (Shoulders' target is 12, Back's 16), with every muscle capped at 4 so one muscle's extra can't cover for another. Shoulders at 8 of 12 points is 67%; 100% means every shoulder muscle has its 4. Percent because groups differ in size. (Until October 19, 2026 a group showed its weakest muscle out of 4.) Under the grid, **Split**: sessions of each kind that week against the targets in `SPLIT_TARGETS` (4 strength, 2 cardio, 2 mobility; sport is counted with no target, and doesn't count as cardio), as a row each in the grid's columns: a grey pip per session the target asks for, dark when done, "+1" past it, and count/target, green at target. A workout counts for every kind it includes (`splitOf`), so stretching logged on a strength session is also a mobility session. The newest week's split is also a line under Next up: "Split: cardio 1/2 this week", or "on track" with the counts. Charts of the mix (a colored bar, grey minute bars, a grey pie) were tried first and dropped: they showed the mix but not whether it was a good one. Kinds come from logged sessions and watch workouts (auto-detected walks left out). Mobility is a category, not a type: the muscles can override the type (`activityCategoriesOf`). A session whose only muscle is Mobility is mobility whatever its type, only Cardio is cardio, and an "other" session with strength muscles is strength. Cardio, mobility and sport were rows of the grid until October 19, 2026. This replaced a 14-day strength grid and a separate 14-day activity grid with "days since" columns.
- **Recent workouts:** grouped by week (Monday to Sunday) with each week's count and minutes. Fitbit workouts (unlabeled walks left out) joined to their sessions for duration, heart rate and strain, plus sessions with no Fitbit link. Chips show muscles by group ("Shoulders: Side Delts, Rear Delts"). A filter row picks one workout type, with counts per type. Each logged one opens to edit its name, type ("Mixed / other" for a bit-of-everything session), muscles (optional), RPE and per-muscle intensity, or to delete it; deleting makes its Fitbit workout unlabeled again. Combined and overlapping watch recordings can be separated or merged ([workout-dedupe.md](workout-dedupe.md)).
- **Unlabeled workouts:** watch workouts whose name doesn't say what was trained (WEIGHTLIFTING, WEIGHTS, CORE_TRAINING, AEROBIC_WORKOUT) from the last 7 days with no session. Each can be labeled with **Label** (optional muscles with intensity, and RPE, saved straight away; the type is what the watch recorded, and the muscles decide whether it counts as strength, mobility or both) or **Chat** (opens chat with a sentence to finish). Any other unlabeled watch workout except walks has the same buttons in Recent workouts; it just isn't asked about. `listUnlabeledWorkouts` in `lib/workouts.ts`. **Ignore** sets one aside (an accidental 1-minute recording): it's saved in `workout_ignores` and left out of matching, Unlabeled, Recent workouts, Activity, the Today timeline and chat's unlabeled list. Day strain still counts it. "N ignored · Show" under Recent workouts lists them with **Restore**.

## Later: per-exercise sets

If set-level detail becomes worth typing, add an `exercises` catalog (name, aliases, primary and secondary muscles, equipment) and `workout_sets` (session, exercise, reps, weight, duration, RPE, warm-up flag), and restore "hard sets per muscle group". Sessions stay as they are; sets hang off them.

## Open questions

- Whether unlabeled Fitbit walks and golf should count as Cardio. They don't for now.
