# Ailments

Status: built November 10, 2026 (feedback d9344d23, first half). Illness, injury and pain as records that last and end, several open at once, feeding the body state and the day's call, which weighs them. Code: `lib/ailments-core.ts` (pure rules), `lib/ailments.ts` (database and chat tools). The other half of Journal 2.0, the tag rework, is [journal-tags.md](journal-tags.md).

## Why

- **Pain went nowhere.** On November 10 the owner told the chat "weird pain in the back of my right rear deltoid". The chat offered "Save to journal" and nothing reached the plan, which kept shoulders open. `body_log` had a `pain` kind that nothing read.
- **Illness was one severity per day** with a fixed symptom list (`illness_days`). It couldn't tell a head cold from a canker sore or an injury, and couldn't hold two at once.

## The model (agreed November 7, 2026)

- **One message makes one card.** "My right shoulder hurts" makes one ailment card ("New pain · Right shoulder"). A check-in answer that mentions it makes one journal card with a line for the shoulder instead. Since November 10, 2026 a pain report on its own is not a journal entry (the owner didn't want it saved as an evening journal, which also counted as answering the evening check-in).
- **Journal entry:** what was said that day, in the owner's words.
- **Ailment:** something that lasts and ends: a cold, a sore shoulder, a canker sore. Each report adds that day to it: an ailment card, or a line on a check-in's journal card ("Right shoulder · day 2 · hurts").
- **Memory** (`chat_memories`): lasting facts about the owner, never ailments or events.

## What one is

| Field | Meaning |
| --- | --- |
| `kind` | `illness` (cold, flu, stomach bug, canker sore), `injury` (something happened: a tweak, a fall), `pain` (it hurts, cause unclear). |
| `name` | Short and plain: "Right shoulder", "Head cold". |
| `body_parts` | In the owner's words, with a side when there is one: "right shoulder", "jaw". A new one folds onto one already in use when it's the same words. Empty for most illnesses. |
| `muscles` | The tracked muscles whose training loads it, picked by the chat; the owner can change them ("curls don't bother it"). |
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

Symptoms are open: the owner's plain words, folded onto ones already in use when it's the same words ("ear ringing" is "ringing ears", `lib/vocab.ts`). The chat gets a few common ones as suggestions (`ILLNESS_SYMPTOMS`, `PAIN_SYMPTOMS`), not a limit.

## How long it counts

Open until the owner says it's over (a 0 day) or an end date is set (the owner, November 10, 2026). Nothing expires on its own: each morning the call asks about every open ailment not reported that day ("How's the right shoulder today?"), and it stays on Today until it's gone. Without a new report an ailment stays at its last severity. An illness that reached Sick eases back for the 2 days after it ends, as before.

## What it does to training

**What it affects is Claude's call.** Body parts are the owner's words ("right shoulder", "jaw"), and when the chat drafts an injury or pain it picks the tracked muscles whose training loads that spot (a shoulder: pressing and pulling, so chest, delts, triceps, lats, upper back and traps; a jaw: none). The owner can change them through chat ("curls don't bother it"). A fixed body-part table did this at first and was dropped the same day: it filed a jaw under the neck (the owner, November 10, 2026: lean on Claude's judgment, no hard-coded lists or pattern matching).

**Claude weighs it; one hard rule** (the owner, November 10, 2026: limits shouldn't be hard-coded, they should be weighed when Claude decides):

- **Bad (3):** the one hard rule. The whole region of its muscles is out (a bad shoulder rests the whole upper body, arms included) and nothing is hard anywhere. Enforced in the guardrails. Regions: upper is chest, shoulders, arms, lats, upper back and traps; lower is legs and lower back; core is abs, obliques and lower back.
- **Mild or hurts (1-2):** no fixed limit. The guardrails list the ailment with its muscles (`guardrails.ailments`), and the morning call, or the chat revising it, decides how much to spare them from the severity, the day, the trend and what the owner wrote, cardio included (running on a sore knee). The call must say how it treats each one (`ailments`: name and plan, "skipping pressing and rows, light band work only"); `checkCall` sends it back when one is missing. That makes the judgment visible and gives the evals something to check.
- **The rule-based pick** (Next up's default, its fallback when Claude fails, and tomorrow's preview) can't weigh anything, so it stays cautious: no day is picked for affected muscles, and they show in Out tagged with the ailment ("Lats · right shoulder"). `ailmentAvoidOf` in `lib/body-state/build.ts`.

Illness works as before, through the illness phase: Sick or Very sick is rest, Mild is light only, easing back is medium at most.

## In the body state

`physical.ailments` (added November 10, 2026; no new schema version, since older states just lack it):

| Signal | Meaning |
| --- | --- |
| `open[]` | Each open or easing ailment: `id`, `kind`, `name`, `bodyParts`, `since`, `day`, `severity`, `symptoms`, `phase` (`active`, `easing`), `reportedOn`, `peak`, `affects` (muscles), `limits` (the hard ones, from a bad one: `out`, `noHard`), `cause`. Worst first. |
| `ended7[]` | Over in the last 7 days. |

Status: **low** with an illness at Sick or worse, or anything at 3; **watch** with anything open; **ok** while only easing; **good** with nothing open. Headline: the worst one's line, "Right shoulder · day 2, hurts", with "Upper body out, nothing hard" when it's bad.

`physical.illness` keeps the watch signal and its phases; `told` comes from the open illness (`source: "ailment"`, with its `name`), and sick days for the vitals' baselines are every day an illness covered. The old stopgap that read a `sick` journal tag as a sick day is gone.

## In the chat

- `list_ailments`: open ones with their lines, those in the last 60 days with their days, and today's watch illness signal.
- `draft_ailment`: the card for a report outside a check-in (a new ailment with today's day, or today's day for an open one), a change to an ailment (name, body parts, muscles, cause, dates; fields left out are kept), or a past one with its days.
- `draft_journal` takes `ailments` for a check-in answer: one line per ailment mentioned, either `ailment_id` or `new` (kind, name, body parts, cause, workouts it came from). Saving writes the entry and the days in one transaction. `fine_today` records a false alarm on a flagged day (kept in `illness_days` as severity 0).
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
