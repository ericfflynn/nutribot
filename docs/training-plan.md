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
| Light | 1 day (slight, fresh the next day) | 1 |
| Medium | 2 days (sore, fading) | 2 |
| Hard | 4 days (very sore, fading) | 3 |

Weekly target: 4 points per muscle in any 7 days (today included): a hard and a light session, or two medium. **Getting every muscle to 4 is the tab's main goal**; everything else supports it. A session logged as a whole group counts for each of its muscles. `INTENSITY_RULES` and `WEEKLY_TARGET_POINTS` in `lib/workouts.ts`; `loadOf` gives a muscle's points and days until recovered, `bucketOf` puts it in **due** (short and ready), **recovering** (short, not ready) or **covered** (4 or more), and `weekStatus` sorts every strength muscle that way.

## Soreness

Reworked October 25, 2026 (`sorenessOf`, `SORENESS_LEVELS` in `lib/workouts.ts`). Recovery is one **soreness level per muscle**: 0 Fresh, 1 Slight, 2 Sore, 3 Very sore. Workouts set it (light 1, medium 2, hard 3, never lowering it) and it fades `SORENESS_FADE_PER_DAY` (0.75) a day, so very sore is fresh again in 4 days, sore in 2, slight in 1. Halves round down (`sorenessStep`).

The owner can set any muscle's level from the body map (`body_log`, kind `sore`, `level`; one per muscle per day). His level replaces the computed one that day (on a day he also trained the muscle, the higher of the two wins, so "sore this morning" plus a hard session is very sore), holds through the next (soreness peaks the day after) and then fades. It wins both ways: still sore after 5 days holds a muscle back, and "fresh" the day after a hard session makes it ready. "Use workouts instead" deletes that day's level. Any soreness keeps a muscle out of Next up until it's fresh (light blood-flow only if its day comes up); until October 27, 2026 slight still allowed medium work, which left a muscle he'd marked sore in the suggestion. Soreness never changes weekly points.

Until October 25, 2026 soreness was a mild/bad report that only delayed readiness (mild 1 day, bad 3) and recovery was a separate timer (hard 5 days); the owner wanted his input to take precedence and one rating that workouts set and he adjusts. `body_log` also has kind `pain` with plain body parts and a mild/bad `severity`, from the body log plan in [journal-habits-plan.md](journal-habits-plan.md#planned-body-log-for-soreness-and-pain-agreed-october-17-2026-not-built); nothing writes pain yet, and the chat can't set soreness yet (map only).

## What the Training tab reads

From the top (reordered October 27, 2026): **Body map** (with the due list), **Next up** (with the split tiles), **Last 7 days**, **Unlabeled** when there are any, **Week by week** (one grid per 7 days, swiped back), then **Recent workouts** (last 14 days) by week.

- **Body map** (`app/body-map.tsx`): front and back figures drawn from [MuscleMap](https://github.com/melihcolpan/MuscleMap)'s male artwork (MIT, notice kept in `app/body-map-paths.ts`). Each tracked muscle is tinted by its soreness, grey when fresh to deep red when very sore (`fatigueLevel`: level over 3). The rest of the body stays grey. Our muscles map onto its regions: rhomboids and rotator cuff are Upper Back, its "upper back" region is Lats, the trapezius pieces are Traps, its outer deltoid is Side Delts, and Obliques run up the ribs (its grey serratus copy of those shapes, drawn over them, was removed October 27, 2026). Tapping a muscle shows its points out of 4 and its bucket, how long until it's ready, the sessions that counted (with their intensity and points), and **Feels: Fresh / Slight / Sore / Very sore** set to the current level, to change it. A first schematic version with traffic-light colors per bucket was dropped as cheap-looking; red reads as sore, so color shows soreness and the 4-point target lives in the due list and the tap panel.
- **Split tiles:** under Next up, three tiles for the last 7 days' sessions against `SPLIT_TARGETS`: Strength x/4, Cardio x/2, Mobility x/2, the count in red while short. Sport is counted (`splitOf`) but has no target or tile, and doesn't count as cardio. A workout counts for every kind it includes, so stretching logged on a strength session is also a mobility session. Kinds come from logged sessions and watch workouts (auto-detected walks left out). Mobility is a category, not a type: the muscles can override the type (`activityCategoriesOf`). A session whose only muscle is Mobility is mobility whatever its type, only Cardio is cardio, and an "other" session with strength muscles is strength. Cardio, mobility and sport were rows of the grid until October 19, 2026. Picked from four mockups (a text line, tiles, grey rings, pills) after charts of the mix (a colored bar, grey minute bars, a grey pie, per-week pip rows) showed the mix but not whether it was a good one.
- **Last 7 days:** a card under Next up, one row per day, oldest at the top and today at the bottom: each workout (session name or watch workout, minutes) with how hard a lift was or what kind of workout it was, and "Rest" for empty days.
- **Next up:** what to train next (`suggestNext`, see Planning below), for today, or tomorrow once a lift is logged today or after 7 pm: **Fresh** (with days since a real hit), **Out** (any soreness, slight included), the **Suggested** day with each muscle's intensity, sore muscles in it as light blood-flow only and an accessory at the end, **Or:** alternatives, and **After that:** the order of the main days, with rest days for light cardio, yoga or pilates. Mockup E of the options canvas, https://claude.ai/artifact/1skCafFkeuCmawyAqJtCYV. Until October 25, 2026 Next up was one pick for today (`recommendNext`).
- **Due list:** under the map, the due muscles with their points, least first. The rest show their points in the tap panel and the week grid. Progress bars were tried and dropped: on a rolling week they rarely look full.
- **Week by week:** one grid per rolling 7 days (the newest is the same window as the 4-point target), swiped sideways back to the first week with a logged session, at most 8. Rows: the six strength groups. Cells are shaded light, medium or hard in the body map's reds. A group's cell shows how much of the group was worked (`groupDayIntensity`): each muscle's points that day (its hardest; a whole-group session counts for all of them), averaged over the group's muscles and rounded to the nearest intensity, so one medium Side Delts set is a light Shoulders day. Tapping a group expands a row per muscle, shaded by the hardest that muscle got; sessions logged as the whole group shade only the group row. The right column is that week's progress, green at target: each muscle as points out of 4 (what session closes it), each group as a percent of 4 points per muscle (Shoulders' target is 12, Back's 16), with every muscle capped at 4 so one muscle's extra can't cover for another. Shoulders at 8 of 12 points is 67%; 100% means every shoulder muscle has its 4. Percent because groups differ in size. (Until October 19, 2026 a group showed its weakest muscle out of 4.) This replaced a 14-day strength grid and a separate 14-day activity grid with "days since" columns.
- **Recent workouts:** grouped by week (Monday to Sunday) with each week's count and minutes. Fitbit workouts (unlabeled walks left out) joined to their sessions for duration, heart rate and strain, plus sessions with no Fitbit link. Chips show muscles by group ("Shoulders: Side Delts, Rear Delts"). A filter row picks one workout type, with counts per type. Each logged one opens to edit its name, type ("Mixed / other" for a bit-of-everything session), muscles (optional), RPE and per-muscle intensity, or to delete it; deleting makes its Fitbit workout unlabeled again. Combined and overlapping watch recordings can be separated or merged ([workout-dedupe.md](workout-dedupe.md)).
- **Unlabeled workouts:** watch workouts whose name doesn't say what was trained (WEIGHTLIFTING, WEIGHTS, CORE_TRAINING, AEROBIC_WORKOUT) from the last 7 days with no session. Each can be labeled with **Label** (optional muscles with intensity, and RPE, saved straight away; the type is what the watch recorded, and the muscles decide whether it counts as strength, mobility or both) or **Chat** (opens chat with a sentence to finish). Any other unlabeled watch workout except walks has the same buttons in Recent workouts; it just isn't asked about. `listUnlabeledWorkouts` in `lib/workouts.ts`. **Ignore** sets one aside (an accidental 1-minute recording): it's saved in `workout_ignores` and left out of matching, Unlabeled, Recent workouts, Activity, the Today timeline and chat's unlabeled list. Day strain still counts it. "N ignored · Show" under Recent workouts lists them with **Restore**.

## Planning

Added October 25, 2026 (`suggestNext` in `lib/workouts.ts`). It suggests what to train next the way the owner decides: what's out (sore), what's fresh and due, then the day that fits, with alternatives. There are no dates ahead: a missed day leaves the same suggestion up. The goal is every muscle hit every week and none overworked.

- **Due:** fresh (no soreness at all), and `DUE_AFTER_DAYS` (4) or more since its last medium or hard work (light work isn't a hit).
- **The pick:** the day type whose due muscles are most overdue (each muscle's days past 4, capped at 14; at least 2 due): Push (Chest, Front and Side Delts, Triceps), Pull (Lats, Upper Back, Traps, Rear Delts, Biceps, Forearms), Legs (Quads, Hamstrings, Glutes, Calves, Lower Back), Arms (Biceps, Triceps, Forearms) or Shoulders (Front, Side and Rear Delts, Traps). It isn't a strict split: whatever was logged moves each muscle's last hit. Core is added when 2 or more core muscles are due. Nothing due: rest or active recovery.
- **Intensity per muscle:** hard, medium if it already had a hard day in the last 7, lower if a rule says so.
- **Blood-flow:** the day's muscles with any soreness, light only. **Accessory:** up to 2 due muscles outside the day, longest waiting first.
- **Alternatives:** the next two day types. **After that:** push, pull and legs (minus the pick) in the order they'll next have 2 due muscles as soreness fades.

A first version the same day planned five dated days ahead by searching every order of push, pull and legs with points, caps and a session cost; the owner found it hard to follow, so this replaced it.

**Rules** (`TrainingRule`, `DEFAULT_RULES`) can only lower intensity or leave muscles out. They're data, not code, so they can move to a `training_rules` table and be added from chat; new kinds of rule are code. Intensity per muscle comes from logged sessions the usual way, so "rear delts hard" counts.

| Kind | Rule | Default |
| --- | --- | --- |
| `after_hard` | After a hard day on any of these muscles, the next day's work on any of them is at most `maxNext`. | Shoulder joint: Chest, Front/Side/Rear Delts, Triceps, Lats, Upper Back; next day medium. |
| `hard_streak` | At most `maxDays` hard strength days in a row; the next is medium. | 2 |
| `not_after` | The day after any work on `after`, the `skip` muscles aren't trained at all: Next up moves them from Fresh to Out, tagged ("Lats · after forearms"). | Added October 27, 2026: after Forearms or after Biceps, skip Lats, Upper Back, Traps; after Triceps, skip Chest. |

Planned next: a week plan (7 days from today, tap a day to lock in a day type or Cardio / Yoga / Pilates / Golf / Rest, grey suggestions for open days worked out from the locked ones and soreness, warnings on clashes, a missed locked day sliding the rest forward; needs a small table for locked days); tapping an alternative to make it the pick; exercises mapped to primary and secondary muscles; soreness and pain from chat; rules from chat with a Rules list.

## Later: per-exercise sets

If set-level detail becomes worth typing, add an `exercises` catalog (name, aliases, primary and secondary muscles, equipment) and `workout_sets` (session, exercise, reps, weight, duration, RPE, warm-up flag), and restore "hard sets per muscle group". Sessions stay as they are; sets hang off them.

## Open questions

- Whether unlabeled Fitbit walks and golf should count as Cardio. They don't for now.
