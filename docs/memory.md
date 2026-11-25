# Memory (v2, draft)

Status: **built** (November 24, 2026), on the owner's approval of this spec. Replaces the first version (November 6, 2026). Code: `lib/memories-core.ts` (kinds, areas, what's live, where each goes), `lib/memories.ts` (storage, prompt, tools).

## Why

The first version (November 6, 2026) keeps every memory in one list of four kinds and loads all of them into every chat turn. In its first 18 days it saved one memory out of about 200 messages, and that one was undone. On November 24 the owner told the chat "I don't like to do pull after heavy chest". It filed that as an app bug instead of remembering it, so the next morning's call couldn't see it.

The owner's view (November 24, 2026): memories differ in how long they last and in where they matter, and loading all of them everywhere is primitive. A preference about workouts belongs where workouts are recommended. A rough stretch in a relationship belongs next to stress, and it ends. A goal like a lower weight lasts months and should be checked against the data.

## Principles

- **Each kind has its own life and its own place.** A memory's kind says how long it lasts; its areas say where it's used.
- **Code delivers, Claude decides.** Claude chooses what to save, its kind and its areas. Code puts each memory in front of whatever needs it (the call, a tool, the body state), so nothing depends on Claude remembering to look. This is how the first version failed: it depended on Claude, and Claude didn't do it.
- **Small always-on core.** Only what's live and short goes into every turn. The rest arrives with the job it's for.
- **Things end.** Situations carry a review date and fade if nobody brings them up again. Goals end when reached or dropped.
- **Saves stay instant and undoable.** As now: no card, a "Remembered" line with Undo.

## Kinds

| Kind | What | Lasts | Example (synthetic) |
| --- | --- | --- | --- |
| `preference` | How they like things done: training, food, how the chat talks to them | Until they change it | "Doesn't want a pull day right after a heavy chest day." |
| `situation` | Something going on in their life that colors stress, mood, sleep or energy | Weeks; needs a review date | "Tension at home with partner since Nov 20; a likely stressor." |
| `goal` | Something they're working toward, optionally with a number | Months, until reached or dropped | "Get to 180 lb." Target: weight 180 lb. |
| `fact` | Lasting background: people, work, history | Lasting | "Sam is their younger brother, lives in Boston." |
| `pattern` | A cause and effect they agree with | Until measured or dropped | "Sleeps badly after late gaming." |

From v1, `about` becomes `fact` (or `preference`, where it's one) and `ongoing` becomes `situation`. `goal` and `pattern` stay. Patterns are the owner's word; once [Causes and effects](body-state.md#causes-and-effects) is built, a pattern can be checked against the measured numbers.

## Areas

Each memory carries one or more **areas**: body-state paths ([body-state.md](body-state.md)), plus `chat` for how the chat should talk to them.

`physical.training`, `physical.sleep`, `physical.recovery`, `physical.fuel`, `physical.ailments`, `mental.mood`, `lifestyle.career`, `lifestyle.relationships`, `lifestyle.habits`, `chat`.

Claude picks them when it saves. Code checks that a memory has at least one valid area, and that a situation has a review date (it checks that Claude answered, not what it answered).

## Where each is used

| Where | Gets |
| --- | --- |
| **Every chat turn** (the core) | Active goals, live situations, `chat` preferences. Plus `<follow_ups_due>` as now. |
| **The morning call** ([body-state.md](body-state.md#the-call)) | `physical.training` and `physical.ailments` preferences and patterns, goals, live situations. The call prompt treats preferences like the owner's own rules unless their body says otherwise, and names in `reasons` any memory that changed the call. |
| **Chat tools** | Each tool's result carries the memories for its area. `get_body_state`: training, sleep and recovery preferences and patterns. `draft_workout` and `list_workouts`: training preferences. `draft_meal` and `get_goals`: `physical.fuel` preferences and goals. `list_habits` and `draft_habits`: `lifestyle.habits` patterns. So when Claude does a job, the right memories show up with it. |
| **The body state** | Live situations in `mental.mood`, `lifestyle.career` and `lifestyle.relationships` are listed in that area (`situations[]`) and become an explanation of kind `situation` ("tension at home since Nov 20"), so a stress rise or an HRV dip can be tied to it. They don't change any status; Claude weighs them, as with ailments. |
| **Search** | `list_memories` takes an area or words ("Sam", "knee") and finds facts and anything else. The prompt has Claude search when a person, place or past event comes up that it doesn't know. |

Facts aren't in the core. As they pile up they'd crowd every turn, and they're only needed when their subject comes up.

## Situations end

- A situation gets a **review date** when saved: Claude picks it from what it is (a week for a deadline, two weeks for a rough patch). The chat checks in on it naturally once the date comes, then resolves it or pushes the date out.
- A situation **goes stale** once its review date is 7 days past and nothing has updated it. A stale situation leaves the core, the call and the body state, but search still finds it. Staleness is computed, not stored, so updating the situation brings it back.
- When the owner says it's over, it's resolved.

## Goals

- A goal can carry a **target** that code can measure. In v1 that's only weight (`{ metric: "weight_lb", target: 180 }`) against the weigh-ins already loaded (`listWeighIns`). The core then shows the goal with where they are ("180 lb goal: 191 now, down 4 in 30 days").
- A goal with no number ("visible abs") stays words. Claude connects it to what it can see (protein, calories, the scale, core work).
- Reached or dropped means resolved.

## Capturing

The prompt names the moments that become memories, since v1's "save what will matter later" turned out too vague:

- They **push back on or react to a recommendation** (the call, a training answer, meal advice): a `preference` in that area. They only file app feedback ([feedback](brain.md)) when the app itself is broken, not when they disagree with a plan.
- They mention **something going on** that affects how they feel: a `situation`, with a review date.
- They say what they **want to reach**: a `goal`, with a target when it's a weight.
- They mention a **person, their job or their history** for the first time: a `fact`.
- They **agree with a pattern** the chat or the data points out: a `pattern`.
- As now: "remember …" always saves (`told`). Before saving, Claude checks for a memory that already covers it and updates that instead.

## Schema

`chat_memories` keeps its rows. Changes (idempotent, in `supabase/schema.sql`):

```sql
alter table public.chat_memories drop constraint if exists chat_memories_kind_check;
update public.chat_memories set kind = 'fact' where kind = 'about';
update public.chat_memories set kind = 'situation' where kind = 'ongoing';
alter table public.chat_memories add constraint chat_memories_kind_check
  check (kind in ('preference', 'situation', 'goal', 'fact', 'pattern'));
alter table public.chat_memories add column if not exists areas text[] not null default '{}';
alter table public.chat_memories add column if not exists target jsonb; -- goals: { metric, target }
```

`follow_up_on` stays: it's the review date for situations and a question date for anything else. There's one row today (forgotten), so the update only renames.

The body state gains an optional `situations[]` in three areas and a `situation` explanation kind. Both are additions, so no new `SCHEMA_VERSION` ([Schema versions](body-state.md#schema-versions)): older stored states just lack them. A situation explanation is context only: code leaves it out of the illness check and the "after …" causes in headlines, since a situation lasts weeks and would explain away every warning.

## Build order

1. Schema, kinds and areas in `lib/memories.ts`; `remember` and `update_memory` take areas and target, and check them.
2. The core in place of "every memory every turn"; `list_memories` with area and word search.
3. The call reads its memories; `reasons` names them.
4. Tools carry their area's memories.
5. Situations into the body state (schema version bump).
6. Goal targets against weigh-ins.
7. Capture prompt, then try it with `npm run brain` on real phrasings (pushback on a call, a stressor, a goal, a new person) before shipping.

## Decided while building (November 24, 2026)

- **Facts are in the core while there are 20 or fewer** (`CORE_FACTS_MAX`). Journal tagging tells Claude to check memories for who's who (partner, family), so people need to be at hand. Past 20, search only.
- **Memories also feed the chat's revision of the call** through `get_body_state`.
- **The core's last line counts the rest** ("4 more, by area"), so Claude knows there's more to search.

## Open questions

- **A page for memories?** Still chat-only ("what do you remember about me"). A list on Profile, grouped by kind, with edit and forget, would make it easier to trust.
- **Other measurable goals:** zone minutes and protein are already measured and could be targets too. v2 does weight only.
