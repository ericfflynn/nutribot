# Duplicate workouts

Status: built October 12, 2026.

## The problem

Every exercise record comes from one source, Google Health (which is where Fitbit data arrives), but Fitbit sometimes records one physical workout more than once:

- a 0-minute stub left by a start that misfired, inside the real workout;
- a run paused and restarted, saved as two overlapping recordings;
- an auto-detected walk alongside a walk that was started by hand.

Each recording showed up as its own row on Today's timeline and the Training tab, and the chat counted them separately. Daily totals (steps, calories, distance, zone minutes) come from Fitbit's daily records, not from adding up workouts, so the totals were never double-counted. Per-workout views and strain were.

## How it's fixed

Duplicates are folded at the data layer, so every reader gets one row per workout without its own filtering.

| Piece | Role |
| --- | --- |
| `health_workout_records` view | One row per Fitbit exercise record, duplicates included (the old `health_workouts`). |
| `health_workout_merges` table | Maps each duplicate `record_key` to its `canonical_key`. A row whose two keys match pins a record on its own. `decided_by` is `auto` or `user`. |
| `health_workouts` view | Canonical records only, with `merged_ids` listing what was folded in. Everything in the app reads this. |
| `lib/health/dedupe-rules.ts` | Pure matching rules, covered by `tests/dedupe.test.ts`. |
| `lib/health/dedupe.ts` | Loads records, rebuilds the auto rows, applies the owner's merges and splits, and relinks logged sessions. |

### Matching rules

Two records are the same workout when:

1. they're the same kind of activity: the same exercise type, or related types (walking and hiking, running and treadmill, biking and spinning, weightlifting and weights); and
2. at least half of the shorter one overlaps the longer one. A 0-minute stub counts when it starts inside the other record, with a minute of slack.

Overlaps chain, so a long walk, a nested walk and a stub become one workout. Different activities never merge automatically: a walk to the gym that overlaps a lifting session by two minutes is two workouts. Overlaps that don't qualify show as **Overlaps … · Merge** on the Training tab, for the owner to decide.

### Choosing the canonical record and its metrics

The most complete recording wins: the longest active time, then the most metrics present, then the most calories, then the lowest id, so the choice is stable from run to run. The view takes each metric from the canonical record, and only when it lacks one uses the largest value among its duplicates. Metrics are never summed across recordings. Start and end times are the canonical record's.

### Provenance and manual control

Nothing is deleted. Raw payloads stay in `health_records`, `health_workout_records` still shows every recording, and `merged_ids` says which recordings a workout absorbed.

On the Training tab:

- a combined workout says **Combined from N watch recordings · Separate**. Separate pins every recording on its own, and later syncs leave them apart;
- **Merge** on an overlapping workout folds the two (and anything already folded into either) under the more complete one.

Both write `user` rows, which auto-detection never overrides.

### Syncs

After every exercise sync (cron, the Refresh button, or the chat's quick sync), `runHealthSync` calls `reconcileWorkoutDuplicates` before linking pending sessions. It deletes the `auto` rows and recomputes them from the current records in one transaction, so repeated syncs give the same answer and duplicates don't come back. A logged session linked to a recording that turns out to be a duplicate moves to the canonical recording, unless another session already holds it.

`npm run workouts:dedupe` prints the plan without writing; `-- --apply` writes it.

## Results on real data (October 12, 2026)

157 recordings became 153 workouts: 4 duplicates folded into 3 workouts (a weightlifting stub, a nested walk plus a walk stub, a run recorded twice). One walk and lifting session overlap is left for the owner to decide. No logged sessions pointed at a duplicate.
