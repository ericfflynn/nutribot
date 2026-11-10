# Ailments

Status: built November 10, 2026 (feedback d9344d23, first half). Illness, injury and pain as records that last and end, several open at once, feeding the body state and the day's call, which weighs them. Code: `lib/ailments-core.ts` (pure rules), `lib/ailments.ts` (database and chat tools). The journal tag rework, the other half of Journal 2.0, is on hold until ailments settle ([Tags, on hold](#tags-on-hold)).

## Why

- **Pain went nowhere.** On November 10 the owner told the chat "weird pain in the back of my right rear deltoid". The chat offered "Save to journal" and nothing reached the plan, which kept shoulders open. `body_log` had a `pain` kind that nothing read.
- **Illness was one severity per day** with a fixed symptom list (`illness_days`). It couldn't tell a head cold from a canker sore or an injury, and couldn't hold two at once.

## The model (agreed November 7, 2026)

- **One message makes one card.** "My right shoulder hurts" makes one journal card with a line for the shoulder. Nothing is logged separately.
- **Journal entry:** what was said that day, in the owner's words.
- **Ailment:** something that lasts and ends: a cold, a sore shoulder, a canker sore. Each journal card that mentions it adds that day to it, shown as a line on the card ("Right shoulder · day 2 · hurts").
- **Memory** (`chat_memories`): lasting facts about the owner, never ailments or events.

## What one is

| Field | Meaning |
| --- | --- |
| `kind` | `illness` (cold, flu, stomach bug, canker sore), `injury` (something happened: a tweak, a fall), `pain` (it hurts, cause unclear). |
| `name` | Short and plain: "Right shoulder", "Head cold". |
| `body_parts` | From `BODY_PARTS` or a muscle ("rear delts"), with a side when there is one: "right shoulder". Empty for most illnesses. |
| `muscles` | The tracked muscles it affects. Filled from the body parts; the owner can change it through chat ("curls don't bother it"). |
| `started_on`, `ended_on` | `ended_on` is null while it's open. |
| `cause`, `cause_refs` | The owner's words or guess, plus the workouts it likely came from, so causes and effects can be measured later. Often unknown at first. |
| days | `ailment_days`: one per day mentioned, with `severity`, `symptoms`, a short `note` and the journal entry it came from. |

## Severity

| | Illness | Injury or pain |
| --- | --- | --- |
| 0 | Better: over it | Gone |
| 1 | Mild: a bit off, above the neck | Mild: noticeable, most movements fine |
| 2 | Sick: clearly unwell, below the neck or a fever | Hurts: some movements hurt |
| 3 | Very sick: in bed | Bad: hurts at rest or gets in the way of the day |

Symptoms: illness keeps the old list plus `canker sore`, `swollen lymph nodes`, `tooth pain`, `ear pressure`; injury and pain take `sharp`, `dull ache`, `stiff`, `clicking`, `weak`, `swelling`, `numb or tingling`.

## How long it counts

Open until the owner says it's over (a 0 day) or an end date is set (the owner, November 10, 2026). Nothing expires on its own: each morning the call asks about every open ailment not reported that day ("How's the right shoulder today?"), and it stays on Today until it's gone. Without a new report an ailment stays at its last severity. An illness that reached Sick eases back for the 2 days after it ends, as before.

## What it does to training

Each body part limits the muscles whose work loads it (`BODY_PARTS`):

| Body part | Muscles | Region |
| --- | --- | --- |
| shoulder | Chest, Front/Side/Rear Delts, Triceps, Lats, Upper Back, Traps | upper |
| elbow | Biceps, Triceps, Forearms | upper |
| wrist, hand | Forearms, Biceps, Lats, Upper Back, Traps (grip), Chest, Triceps (pressing) | upper |
| neck | Traps, Upper Back | upper |
| upper back | Upper Back, Traps, Lats | upper |
| chest | Chest, Obliques | upper |
| ribs | Chest, Obliques | core |
| lower back | Lower Back, Hamstrings, Glutes | core |
| abs | Upper Abs, Lower Abs, Obliques | core |
| hip | Glutes, Hamstrings, Quads | lower |
| knee, ankle, foot | Quads, Hamstrings, Calves (knee); Calves, Quads (ankle, foot); easy cardio only from 2 | lower |
| a muscle ("rear delts") | That muscle | its own |

Regions: upper is chest, shoulders, arms, lats, upper back and traps; lower is legs and lower back; core is abs, obliques and lower back.

**Claude weighs it; one hard rule** (the owner, November 10, 2026: limits shouldn't be hard-coded, they should be weighed when Claude decides):

- **Bad (3):** the one hard rule. Its whole region is out (a bad shoulder rests the whole upper body, arms included) and nothing is hard anywhere. Enforced in the guardrails.
- **Mild or hurts (1-2):** no fixed limit. The guardrails list the ailment with the muscles it affects (`guardrails.ailments`), and the morning call, or the chat revising it, decides how much to spare them from the severity, the day, the trend and what the owner wrote. The one check (`checkCall`): working an affected muscle past light needs a reason that names the ailment, so the judgment is visible and can be evaluated.
- **The rule-based pick** (Next up's default, its fallback when Claude fails, and tomorrow's preview) can't weigh anything, so it stays cautious: no day is picked for affected muscles, and they show in Out tagged with the ailment ("Lats · right shoulder"). `ailmentAvoidOf` in `lib/body-state/build.ts`.
- A knee, ankle or foot at 2+ flags `easyCardio` for Claude: nothing pounding.

Illness works as before, through the illness phase: Sick or Very sick is rest, Mild is light only, easing back is medium at most.

## In the body state

`physical.ailments` (added November 10, 2026; no new schema version, since older states just lack it):

| Signal | Meaning |
| --- | --- |
| `open[]` | Each open or easing ailment: `id`, `kind`, `name`, `bodyParts`, `since`, `day`, `severity`, `symptoms`, `phase` (`active`, `easing`), `reportedOn`, `peak`, `affects` (muscles), `easyCardio`, `limits` (the hard ones, from a bad one: `out`, `noHard`), `cause`. Worst first. |
| `ended7[]` | Over in the last 7 days. |

Status: **low** with an illness at Sick or worse, or anything at 3; **watch** with anything open; **ok** while only easing; **good** with nothing open. Headline: the worst one's line, "Right shoulder · day 2, hurts", with "Upper body out, nothing hard" when it's bad.

`physical.illness` keeps the watch signal and its phases; `told` comes from the open illness (`source: "ailment"`, with its `name`), and sick days for the vitals' baselines are every day an illness covered. The old stopgap that read a `sick` journal tag as a sick day is gone.

## In the chat

- `list_ailments`: open ones with their lines, those in the last 60 days with their days, and today's watch illness signal.
- `draft_journal` takes `ailments`: one line per ailment mentioned, either `ailment_id` or `new` (kind, name, body parts, cause, workouts it came from). Saving writes the entry and the days in one transaction. Pain or illness mid-conversation gets a full card, not the "Save to journal" offer. `fine_today` records a false alarm on a flagged day (kept in `illness_days` as severity 0).
- `draft_ailment`: changes an ailment itself (name, body parts, muscles, cause, dates) or logs a past one with its days.
- `draft_illness` and `list_illness` are gone; old illness cards in the chat still show but can't be saved.
- The morning call reads `physical.ailments`, plans around them, names them in the note and asks about each one not reported today.

## Where it shows

- **Today:** under the scores, early signs from the watch, then one line per open ailment ("Right shoulder · day 2, hurts · Upper body out"), each opening the chat with its name; one that ended today shows as over.
- **Timeline:** a journal row lists its ailment lines after the ratings.
- **Training:** Next up shows the day's call; the rule-based preview's out muscles carry the ailment's name, with a line saying what it skips.

## Storage

`ailments` and `ailment_days` in `supabase/schema.sql`. A second report on the same day replaces it; a 0 sets `ended_on`; a report after the end opens it again (it came back).

## Backfill (November 10, 2026)

From the watch and the journal, confirmed by the owner: an early October illness (watch early signs from about October 1, swollen lymph nodes, tooth pain and a canker sore October 10-12, over October 13) and the cold from October 27 (congestion, ear pressure, headache; over November 1). The wrist pain after the October 27 dead hangs was left out at the owner's request. `illness_days` is kept for the "fine" answers; its sick rows are no longer read.

## Later

- Causes and effects ([body-state.md](body-state.md#causes-and-effects)): ailments with their cause workouts are the labels for "what gets my shoulder" (the owner suspects pushups, then a shoulder day, then golf, November 2026).
- An ailment history view; ailments on the trend charts.
- The evals ([README](../README.md#roadmap)): "my shoulder hurts" must make a journal card with a new shoulder ailment and a call without the upper body.

## Tags, on hold

Spec from November 10, 2026, on hold until ailments settle (the owner wants to dig into the journal more first).


### Shape

A tag is a key and a word: `work:deadline`, shown as "Work · deadline". A key alone (`work`) means it came up with nothing more specific. Stored in the same `journal_entries.tags` column, so no table change. One to four per entry.

Rules (agreed October 17, 2026): no numbers; neutral, since how it felt is the mood and stress ratings ("mood on `family:visit` days"); no tags for what other data covers (workouts, sleep, meals, drinks and other habits, soreness, and now ailments).

### The keys

One registry (`lib/body-state/areas.ts`): each key belongs to an area, and the journal's vocabulary is generated from it. Values are suggestions; the chat reuses the owner's earlier values (`list_journal`) before inventing one, and values are normalized as now (synonyms, plurals).

| Key | Area | Suggested values |
| --- | --- | --- |
| `work` | `lifestyle.career` | deadline, meeting, coding, presentation, launch, travel, long day, day off |
| `social` | `lifestyle.relationships` | friends, party, dinner out, hosting, game, alone time |
| `relationship` | `lifestyle.relationships` | date, time together, apart, argument |
| `family` | `lifestyle.relationships` | visit, call, holiday, argument |
| `leisure` | `lifestyle` (stored; an area when wanted) | sports, outdoors, tv, music, hobby, trip |
| `stressor` | `mental.mood` | work, money, health, family, relationship, logistics: what's behind the stress, only when they say |
| `health` | `physical.illness` | fine (the false-alarm answer), doctor, dentist, meds |

The keys are fixed in code (the draft schema rejects others). A new key means an area or a home in one, per [Adding an area](body-state.md#adding-an-area).

### What reads them

- **`lifestyle.career`:** entries with a `work` tag. The `burnout` rule becomes stress 5 on a work day in the last 3 days, or `stressor:work` 3 days running.
- **`lifestyle.relationships`:** `social`, `relationship` and `family` tags; `conflict` becomes an `argument` value.
- **`mental.mood`:** `stressor` values in the headline when stress is 4+ ("Stress 4, work").
- **Causes and effects** (later): one column per key, so "HRV after `social:party` nights" is a query.

### Habits tab

The Journal card groups tags by key with counts, filters by a key or a `key:value`, and keeps mood and stress with the tag against without. The entry editor picks a key, then a value (or types one).

### Moving old tags

A script (`npm run journal:retag`, dry run; `-- --apply` writes after the owner approves) maps the 30 existing tags:

| Old | New |
| --- | --- |
| work | `work` |
| coding, deadline | `work:coding`, `work:deadline` |
| partner | `relationship` |
| friends, social | `social:friends`, `social` |
| family time | `family` |
| relaxing | `leisure` |
| stress | `stressor` when the text names a cause (Claude reads the entry); otherwise dropped, since the stress rating has it |
| sick, headache, morning headache, health, canker sore, swollen lymph nodes, tooth | Dropped as tags; they fed the ailment backfill |
| workout, sore, sore X, diet, tired, good sleep, poor sleep, productive, low motivation, gratitude | Dropped: other data or the ratings cover them |

The dry run prints each entry's old and new tags by id, never the text.

