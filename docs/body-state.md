# Body state

Status: step 1 of the build order built October 30, 2026 (`lib/body-state/`: built on demand, read by the chat through `get_body_state`; nothing stored yet). The rest is spec. This is the core model of NutriBot: one daily picture of the owner's body and mind, in domains (physical, mental, lifestyle), areas and signals, that every part of the app reads, from the Home card to Training's Next up, the chat and the morning check-in.

## Why

Each part of the app reads its own data today. Scores read the watch, Next up reads logged workouts and soreness, the illness signal reads vitals, and the chat reads whatever its tools return. Nothing combines them, so they disagree: on October 30 Next up suggested a hard pull day while the owner was sick and the watch showed it. Nothing is stored either, so the app can't say what it believed last Tuesday or whether its early warning was right.

The body state fixes both: one structure, built by code from every source, stored every day, explained to Claude, and confirmed by the owner.

## Principles

1. **One model, every reader.** Home, Training, the chat and pushes all read the same body state for a day. If two screens disagree, one of them is a bug.
2. **Code builds facts; Claude judges; the owner's word wins.**
   - Facts (numbers, baselines, streaks, what's due) are computed by code, deterministically.
   - Limits (guardrails) are computed by code from the facts.
   - Claude makes the day's call and writes the note, inside the limits.
   - What the owner says (sick, fine, sore, it was just drinks) overrides what the data suggests.
3. **Every judgment shows its evidence.** A reason points at state fields ("resting HR 60, usually 57, up 3 days"), never at a vibe.
4. **Missing is null.** No guessed values and no zeros for "no data". Each section says how complete it is.
5. **Stored over time.** Each day's state is saved as built, with versions as the day changes, so history can be read back and the model tuned against what happened.
6. **Simple rules over clever scores.** Thresholds a person can check in their head (see [training-plan.md](training-plan.md) for why).

## How it fits together

```
sources ─▶ body state (facts) ─▶ guardrails (limits) ─▶ the call (Claude) ─▶ the owner confirms
  watch       code, deterministic    code, deterministic    within the limits    journal, buttons
  workouts                                                  falls back to rules
  journal                         all stored together per day, as versions
  habits
  meals
```

- **Body state:** what is true about the body this morning, with evidence.
- **Guardrails:** what's allowed today: rest or not, the most intensity, muscles that are out, and why.
- **Call:** what to do today, with a short coach note and what Claude wants confirmed.
- **Confirmation:** the owner's answer, saved as a report, which rebuilds the state.

## The body state

One JSON object per user per day, built by `buildBodyState(sources, date)`: a pure function, unit-tested like `suggestNext`. It has three levels:

```
body state
├── physical                 domain: status + headline
│   ├── sleep                area: status + headline + signals
│   ├── recovery
│   ├── vitals
│   ├── illness
│   ├── load
│   ├── training
│   └── fuel
├── mental
│   └── mood
└── lifestyle
    ├── habits
    ├── career
    └── relationships
```

- **Domains** answer "how am I doing" at a glance: physical, mental and lifestyle. More can be added later without touching the others.
- **Areas** are the parts of a domain, each with its own rule for its status.
- **Signals** are the numbers and evidence under an area, each with the window it came from.

Every domain and area has the same head:

```ts
type Status = "good" | "ok" | "watch" | "low" | "unknown";

type Head = {
  status: Status;      // unknown when the area has no data for the day
  headline: string;    // one line with the evidence: "Resting HR 60, usually 57, up 3 days"
};
```

- **An area's status** comes from its own rule (the tables below). These are simple thresholds, not scores.
- **A domain's status** is its worst known area, and its headline is that area's headline. `physical.training` is the exception: it has a status but doesn't roll up. Unknown areas are skipped; a domain whose areas are all unknown is unknown.
- **Order** for "worst": low, watch, ok, good.

So the top of a day reads like "Physical: low, sick, day 3 · Mental: ok, mood 3 · Lifestyle: good", and any reader can drill down to the signal that set it.

### `meta`

| Field | Type | Meaning |
| --- | --- | --- |
| `date` | date | The local day this state is for. |
| `schemaVersion` | int | Bumped when fields change meaning, so old rows stay readable. |
| `builtAt` | timestamp | When it was built. |
| `trigger` | `morning` \| `checkin` \| `report` \| `refresh` | What built this version. |
| `dataThrough` | timestamp | The last successful health sync it used. |
| `lastNightIn` | bool | Whether last night's sleep has synced. A morning state without it is provisional. |
| `missing` | string[] | Sources with no data for the day (`"hrv"`, `"meals"`, `"journal"`). |

## Physical

### `physical.sleep`: last night and the trend

| Signal | Meaning |
| --- | --- |
| `minutes`, `needMinutes`, `pct` | Asleep, need (8 h, `SLEEP_NEED_MINUTES`) and percent, as in [scores.md](scores.md). |
| `bedtime`, `wakeTime` | Local times. |
| `deepMinutes`, `remMinutes`, `lightMinutes`, `awakeMinutes` | Stages. |
| `nights7` | The last 7 nights by stage, for the sleep chart. |
| `debt3n` | Total shortfall over the last 3 nights, in minutes (only nights under need count). |
| `bedtimeDrift7n` | How far last night's bedtime was from the 7-night median, in minutes; late nights show up here. |

Status: **good** at 90%+ with `debt3n` under 60; **low** under 60%; **watch** under 75% or `debt3n` 120+; otherwise **ok**.

### `physical.recovery`

| Signal | Meaning |
| --- | --- |
| `score`, `band` | Today's Recovery (`recoveryScore`), green, yellow or red. |
| `trend7` | The last 7 days' scores, oldest first, nulls for gaps. |
| `vsPrior7` | Today minus the average of the 7 days before. |
| `lowStreak` | Days in a row at yellow or red. |

Status: green **good**, yellow **ok**, red **low**; yellow under 50 with `lowStreak` 3+ is **watch** (yellow alone is common for this owner; calibrated October 30, 2026).

### `physical.vitals`: each against the owner's baseline

Each vital is a `Vital`:

```ts
type Vital = {
  value: number | null;   // today
  usual: number | null;   // baseline: mean (median for HRV) of days −31 to −4, sick days left out
  delta: number | null;   // value − usual
  z: number | null;       // delta / baseline spread (floored)
  streak: number;         // days in a row past the vital's threshold, today included
  trend7: (number | null)[];
};
```

| Vital | Source | Threshold for `streak` |
| --- | --- | --- |
| `restingHr` | `health_daily.resting_hr` | +3 bpm |
| `hrv` | `hrv_ms` | 20% under usual |
| `sleepTemp` | `sleep_temp_vs_baseline_c` (already relative) | +0.4°C |
| `breathing` | `breaths_per_min` | +1/min |
| `spo2` | `spo2_pct` | 2 points under usual |

The baseline rules are the illness detector's ([illness.md](illness.md)): 28 days, the 3 days before left out, logged sick days left out, at least 14 days or `usual` is null.

Status: **good** when no vital is past its threshold; **watch** when any is; **low** when resting HR's `streak` is 3+ or two vitals are past their thresholds together.

### `physical.illness`

| Signal | Meaning |
| --- | --- |
| `signal` | The watch's read: `none`, `possible`, `likely`, with `points` and `reasons` (`illnessSignal`). |
| `told` | The owner's latest report: `severity` (0 Better to 3 Very sick), `symptoms`, `since`, `day` (day number), `reportedOn`, `source` (`journal`, `button`, `chat`). Null if none in the current episode. |
| `phase` | One of the phases below. |
| `phaseSince` | When the current phase started. |

**Phases**, decided by rules in this order:

| Phase | When | Status |
| --- | --- | --- |
| `sick` | The owner reported severity 1+ in the current episode, with no Better since (a report carries 2 days without a new one, as in [illness.md](illness.md)). | **low** |
| `recovering` | Within 2 days after an episode that reached Sick (2+) ended. | **ok** |
| `early_signs` | The signal is `likely`, or `possible` with no explanation that fits (see Explanations), and the owner hasn't answered it ("fine" or "sick") today. | **watch** |
| `well` | Anything else. | **good** |

"I feel fine" on a flagged day is stored as a report (a false alarm), which moves the phase back to `well` and is what the detector is tuned against.

### `physical.load`: how hard recent days were

| Signal | Meaning |
| --- | --- |
| `strainYesterday` | Day strain (`dayStrain`). |
| `strain7`, `strain28` | Average day strain over 7 and 28 days. |
| `loadRatio` | `strain7 / strain28`: above about 1.3 is a sharp ramp, below 0.8 is a lighter stretch. |
| `hardStreak` | Hard strength days in a row, up to yesterday. |
| `daysSinceRest` | Days since a day with no strength or hard cardio. |
| `trend7` | Day strain for the 7 days to today (today partial). |

Status: **watch** when `loadRatio` is over 1.3, `hardStreak` is 2+ or `daysSinceRest` is 6+; otherwise **good**.

### `physical.training`: what's due

These come straight from the Training model ([training-plan.md](training-plan.md)), so the two can't disagree.

- `muscles[]`, one per tracked muscle: `soreness` (level 0-3, `source`: `workout` or `told`), `points7` (out of 4), `daysSinceHit`, `readyIn`, `out` (null, or why: `sore`, `after forearms`).
- `groups`: days since each day type's muscles were last worked (`push`, `pull`, `legs`, `arms`, `shoulders`, `core`).
- `due[]`: muscles fresh and 4+ days since a real hit, most overdue first.
- `split`: strength, cardio and mobility sessions in the last 7 days against 4, 2 and 2.

Status: **watch** when push, pull or legs (the main day types; arms and shoulders are optional picks) has gone 7+ days, by its middle muscle; otherwise **good**. The headline names what's most due ("Legs due, 6 days"). Training is what's due, not how the body is, so it doesn't set the physical domain's status (October 30, 2026: it held the domain on watch 17 days of October).

### `physical.fuel`: yesterday and today so far

| Signal | Meaning |
| --- | --- |
| `yesterday` | Calories, protein (g) and water (oz), each with its target (`get_goals` math, workouts included), or null when nothing was logged. |
| `today` | The same so far, for the evening check-in. |
| `proteinStreak` | Days in a row under 80% of the protein target, with logged meals. |

Status: **unknown** with no meals logged yesterday; **watch** when `proteinStreak` is 3+ or yesterday's calories were under 70% of target; otherwise **good**.

## Mental

### `mental.mood`: what the journal says

| Signal | Meaning |
| --- | --- |
| `mood`, `stress`, `energy` | The latest rating of each in the last 2 days, with its date (journal ratings). `soreness` ratings feed `physical.training` instead. |
| `trend7` | Mood by day for 7 days, nulls for gaps. |
| `lowStreak` | Days in a row with mood 2 or under. |
| `lastEntries` | Ids and dates of the last 2 journal entries. The text itself goes to Claude when it makes the call, not into the stored state. |

Status: **unknown** with no rating in 2 days; **low** at mood 1 or `lowStreak` 3+; **watch** at mood 2 or stress 4+; **good** at mood 4+ with stress under 3; otherwise **ok**.

Mental areas to add later, each its own area with its own rule: stress load over a week, social contact, work. The journal tag categories ([journal-habits-plan.md](journal-habits-plan.md)) are the obvious source.

## Lifestyle

What the owner's life is doing to the rest: habits, work and the people around him. These areas grow as the owner adds them (see Adding an area).

### `lifestyle.habits`: things that move the numbers

| Signal | Meaning |
| --- | --- |
| `yesterday[]` | Each active habit's outcome for yesterday (`met`, `miss-1` to `miss-3`, `used`, `unknown`), with its level and minutes past cutoff. |
| `missStreaks[]` | Habits missed on 3+ of the last 5 tracked days. |

Status: **unknown** with nothing logged yesterday; **watch** with a miss streak or any explanation from a habit (below); **good** when every logged habit was met; otherwise **ok**.

### `lifestyle.career`: work

| Signal | Meaning |
| --- | --- |
| `workStress` | Stress ratings over the last 3 days on entries tagged in the Work category (`work`, `deadline`, `meeting`, `burnout`...). |
| `workDays7` | Days in the last 7 with a Work tag. |
| `latestTag` | The most recent Work tag and its date ("deadline", Tuesday). |

Status: **unknown** with no Work tag in 7 days; **low** with a `burnout` tag in 3 days; **watch** with work stress 4+ in the last 3 days; otherwise **ok**.

### `lifestyle.relationships`: the people around him

| Signal | Meaning |
| --- | --- |
| `recent[]` | Relationships-category tags (`family`, `partner`, `friends`, `conflict`) in the last 7 days, with dates and the mood of that entry. |
| `social7` | Days in the last 7 with a Social-category tag (`social`, `party`, `date night`...). |

Status: **unknown** with no tag in 7 days; **watch** with a `conflict` tag in 3 days; **good** when the last 7 days have a relationships or social tag with mood 4+; otherwise **ok**.

Both areas read journal tags ([journal-habits-plan.md](journal-habits-plan.md)), so they're only as good as the tagging. The planned key:value tag rework would make them sharper.

## Explanations: what else moves the numbers

A low recovery or a raised resting heart rate isn't always illness. Drinking, a late night, a hard training block or work stress do the same thing. Before the illness area calls `early_signs`, the state collects **explanations**: things in the day before that are known to move the vitals.

```ts
type Explanation = {
  kind: "habit" | "late_night" | "load" | "stress";
  detail: string;             // "3 drinks, until 11:40 pm", "work stress 4, deadline"
  affects: ("sleep" | "resting_hr" | "hrv" | "recovery")[];
  source: string;             // the field it came from: "lifestyle.habits", "lifestyle.career"
};
```

| Kind | When |
| --- | --- |
| `habit` | A habit flagged as affecting the body (`affects` on the habit, set from chat or the Habits tab) was used yesterday or last night. Drinking first. |
| `late_night` | Bedtime 90+ minutes past the 7-night median (`physical.sleep.bedtimeDrift7n`). |
| `load` | `physical.load` on watch (sharp ramp or hard streak). |
| `stress` | `lifestyle.career` work stress 4+, or any journal stress 4+, in the last 2 days. |

How they're used:

- **Stored** in `state.explanations[]`, each pointing at the area it came from.
- **Illness:** with a fitting explanation, a `possible` signal stays `well` and a `likely` one stays `early_signs` but the call says it's probably the explanation ("resting HR up 3, likely the drinks: easy day, see how tomorrow looks"). A signal that lasts past the explanation (2+ days after it) counts as illness again. Explanations never override what the owner reports.
- **Recovery:** a low recovery with an explanation reads as that ("recovery 38 after a late night"), not as something wrong.
- **Tuning:** each early warning is stored with its explanations, so false alarms can be checked against them.

## Causes and effects

Explanations use fixed rules at first ("drinks raise resting HR"). Over time the app measures how much each cause actually moves each number for this owner, and keeps that history. Three parts, all deterministic code; Claude suggests and explains, but never produces the numbers.

**1. The daily table.** A flat view over the stored body states, one row per day: the signals worth relating (resting HR, HRV, recovery, sleep minutes, bedtime drift, sleep temperature, day strain, hard day, drinks, late use of any habit, work stress, mood, energy, sick). Body states are for reading a day; this is for comparing days. It's a SQL view, so nothing extra is kept in sync.

**2. Links: what's thought to cause what.** Stored as data, one row per hypothesis:

| Cause | Effect | Lag | Expected |
| --- | --- | --- | --- |
| Drinks (habit) | Resting HR | next morning | up |
| Drinks | HRV, sleep minutes | that night | down |
| Bedtime drift (late night) | Sleep minutes, recovery | that night | down |
| Hard strength day | HRV | next morning | down |
| Day strain | Recovery | next morning | down |
| Work stress | Sleep minutes, HRV | 0-2 days | down |
| Illness | Resting HR, sleep temperature | 0-3 days, often before symptoms | up |
| Work stress (a run of high-stress days) | Illness | 3-10 days | more likely |
| Sleep debt, drinking | Illness | 3-10 days | more likely |
| Sleep debt (3 nights) | Mood, energy | next day | down |

Seeded from physiology; new links come from the owner or from Claude reading the journal ("I sleep badly after late gaming"), and the owner approves each one.

```sql
create table if not exists public.body_links (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  cause text not null,            -- a daily-table column or event: "drinks", "bedtime_drift"
  effect text not null,           -- "resting_hr"
  lag_days int not null,          -- 0 the same night, 1 the next morning
  expected text not null,         -- up | down
  origin text not null,           -- seed | owner | claude
  status text not null default 'active',   -- active | dropped
  created_at timestamptz not null default now()
);

create table if not exists public.body_link_evidence (
  link_id uuid not null references public.body_links (id),
  measured_on date not null,
  n_with int not null,            -- days with the cause
  n_without int not null,
  effect_size numeric,            -- mean difference in the effect's units
  low numeric, high numeric,      -- a rough 80% interval
  verdict text not null,          -- too_few | no_effect | effect | opposite
  primary key (link_id, measured_on)
);
```

**3. Evidence: measured weekly.** For each link, compare the effect on days after the cause with days without it, over everything stored so far:

- **Like with like.** Drinking nights are often late nights and weekends, so the comparison matches on the obvious other causes first (weekday vs weekend, late night, hard day before) and drops sick days.
- **Too few is a result.** Under 8 days with the cause, the verdict is `too_few` and no number is shown.
- **History kept.** Each week adds a row per link, so a link can be seen firming up, fading or not applying to this owner.

**How the rest uses it:** explanations read the measured size when there is one. If drinks usually add 3 bpm and today is +3 after drinks, the drinks explain it; at +6, something more is going on, and the illness area treats the rest as unexplained. The chat can answer "what actually affects my recovery" from the evidence rows.

**Experiments (later).** "No drinks for two weeks" is stronger evidence than any comparison. An experiment is a dated change the owner commits to, tracked like a habit, with the result read against the same links.

## Example (synthetic)

```json
{
  "meta": { "date": "2026-11-12", "schemaVersion": 1, "trigger": "morning", "lastNightIn": true, "missing": ["meals"] },
  "physical": {
    "status": "watch", "headline": "Resting HR 60, usually 57, up 2 days",
    "sleep": { "status": "watch", "headline": "6 h 42 m, 2 h 20 m short over 3 nights", "pct": 84, "debt3n": 140 },
    "recovery": { "status": "watch", "headline": "41, yellow 3 days running", "score": 41, "band": "yellow", "lowStreak": 3 },
    "vitals": {
      "status": "watch", "headline": "Resting HR 60, usually 57, up 2 days",
      "restingHr": { "value": 60, "usual": 57, "delta": 3, "z": 2.6, "streak": 2 }
    },
    "illness": { "status": "watch", "headline": "Early signs since yesterday", "phase": "early_signs", "signal": { "level": "likely", "points": 3 }, "told": null },
    "load": { "status": "watch", "headline": "2 hard days in a row", "loadRatio": 1.4, "hardStreak": 2 },
    "training": { "status": "good", "headline": "Legs due, 6 days", "due": ["Quads", "Hamstrings", "Glutes"] },
    "fuel": { "status": "unknown", "headline": "No meals logged yesterday" }
  },
  "mental": {
    "status": "ok", "headline": "Mood 3, energy low",
    "mood": { "status": "ok", "headline": "Mood 3, energy low", "mood": { "value": 3, "date": "2026-11-11" }, "energy": { "value": 2, "date": "2026-11-11" } }
  },
  "lifestyle": {
    "status": "watch", "headline": "Work stress 4, deadline Tuesday",
    "habits": { "status": "good", "headline": "All habits met yesterday" },
    "career": { "status": "watch", "headline": "Work stress 4, deadline Tuesday", "workStress": [3, 4, 4], "workDays7": 5 },
    "relationships": { "status": "ok", "headline": "Family Sunday" }
  },
  "explanations": [
    { "kind": "stress", "detail": "work stress 4, deadline", "affects": ["sleep", "hrv"], "source": "lifestyle.career" }
  ]
}
```

## Schema versions

The shape of the stored state, one entry per `SCHEMA_VERSION` (`lib/body-state/types.ts`). Changing what a field means, renaming one or moving one takes a new version, an upgrade function in `UPGRADES` (`lib/body-state/store.ts`) from the version before, and an entry here. Adding a field or an area doesn't: old rows just lack it, and readers treat it as unknown. A change that alters values but not the shape (a fixed threshold) needs no version, only a full rebuild (`npm run body:states -- --apply`).

| Version | Date | Shape |
| --- | --- | --- |
| 1 | October 30, 2026 | `meta`; `physical` (sleep, recovery, vitals, illness, load, training, fuel); `mental` (mood); `lifestyle` (habits, career, relationships); `explanations`. Each domain and area carries `status` and `headline`. |

## Adding an area

The model is meant to grow. Adding an area (`lifestyle.finance`, `mental.stress`) takes four things, and nothing else changes:

1. **Signals:** a typed object and the source it's read from.
2. **A status rule:** thresholds from good to low, and when it's unknown.
3. **A headline:** one line with the evidence.
4. **Optionally an explanation kind**, if it moves the physical numbers.

The domain picks the new area up through its worst-area rule, the chat sees it through `get_body_state`, and `schemaVersion` goes up by one. Old stored rows keep their shape; readers treat a missing area as unknown.

## Guardrails

Built by code from the body state, before Claude sees anything. They're the hard edges of the day, and each says which rule set it.

```ts
type Guardrails = {
  rest: boolean;                       // no training today
  maxIntensity: "light" | "medium" | "hard";
  out: { muscle: string; because: string }[];
  allowedKinds: ("rest" | "walk" | "mobility" | "cardio" | "strength")[];
  because: { rule: string; detail: string }[];
};
```

| Rule | Effect |
| --- | --- |
| Illness phase `sick`, severity 2+ | Rest; walk allowed. |
| Illness phase `sick`, severity 1 | Light only. |
| Illness phase `recovering` or `early_signs` | Medium at most. |
| Recovery red | Light only (walk, mobility, easy cardio). Yellow changes nothing, per the owner. |
| Muscle sore (any level) | That muscle is out. |
| Training rules (`DEFAULT_RULES`) | Muscles out after forearms or biceps (back), after triceps (chest); medium after a heavy upper-body day; at most 2 hard days in a row. |
| One hard day per muscle a week | That muscle at most medium. |

Rules only take things away. The strictest wins.

## The call

What to do today: Claude's judgment inside the guardrails, as a structured object validated with Zod.

```ts
type DailyCall = {
  kind: "rest" | "walk" | "mobility" | "cardio" | "strength";
  dayType: string | null;              // "Leg day", for strength
  intensity: "light" | "medium" | "hard";
  focus: string[];                     // muscles to work, all allowed
  accessory: string[];
  headline: string;                    // "Hard leg day", "Rest today"
  note: string;                        // the coach note: 2-4 sentences, plain words, cites the evidence
  reasons: { field: string; text: string }[];  // "physical.vitals.restingHr": "60, usually 57, up 3 days"
  ask: { kind: "illness" | "feel" | "soreness" | "other"; question: string } | null;
  source: "claude" | "rules";
};
```

- **Inputs to Claude:** the body state, the guardrails, the rule-based pick (`suggestNext` within the guardrails) as a default, and the last two journal entries' text.
- **Freedom:** Claude may change intensity and focus within the limits, and may pick a different day type than the rule-based one (agreed October 30, 2026), as long as it says why in `reasons` ("journaled knee pain, so pull instead of legs"). It writes the note and decides what to ask.
- **Checked in code:** every field against the guardrails (kind allowed, intensity at most the cap, no out muscles). A call that breaks one, or a failed or slow run, falls back to the rule-based pick with a plain note (`source: "rules"`). The page never waits on Claude.
- **Reasons cite fields**, so the Home card can show them as rows and the chat can explain them.

## Reports: what the owner says

Things the owner tells the app are reports, and they win over data. They're stored where they already live, and the body state reads them:

| Report | Stored in | Comes from |
| --- | --- | --- |
| Sick, better, "I feel fine" | `illness_days` (severity 0-3; 0 on a flagged day is a false alarm) | Journal entry, quick button, chat |
| Muscle soreness | `body_log` (kind `sore`, level) | Body map, chat |
| Pain | `body_log` (kind `pain`) | Chat |
| Mood, stress, energy | `journal_entries` ratings | Journal |

A journal draft gains an optional `illness` part (severity, symptoms) so saying "still sick, throat's better" in a check-in saves one card that writes both. Saving any report rebuilds the day's state (trigger `report`).

## Storage

One table, the state as JSONB, versioned per day (decided October 30, 2026). JSONB keeps the model free to change while it's young; Postgres can still query and index inside it.

```sql
create table if not exists public.body_states (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  state_date date not null,
  version int not null,            -- 1, 2, ... within the day; the highest is current
  trigger text not null,           -- morning | checkin | report | late_data | rebuild
  schema_version int not null,     -- the shape of `state`
  state jsonb not null,            -- the body state
  state_hash text not null,        -- of `state` without meta, to skip saves that change nothing
  guardrails jsonb,                -- step 4
  call jsonb,                      -- the daily call on the version it was made for; null otherwise
  built_at timestamptz not null default now(),
  unique (user_name, state_date, version)
);

-- Each day's current state: its newest version.
create or replace view public.body_state_current as
select distinct on (user_name, state_date) *
from public.body_states
order by user_name, state_date, version desc;
```

**Reading old rows.** Each row carries `schema_version`. Code reads a row through upgrade functions, one per version step (`upgrade[1]` turns a v1 state into v2, and so on), so readers only ever see the current shape and nothing in the database is migrated. A field that's gone stays in old rows' JSON untouched.

**Past days change.** A day isn't final when it ends: meals, workouts and journal entries get logged late, and the watch syncs late. The newest version is the day's truth; older versions stay as the record of what the app believed at the time, and the call stays on the version it was made for.

- **A late entry rebuilds its day** (trigger `late_data`): saving a meal, workout, journal entry, habit log or report for a past date rebuilds that date, and the following days up to today, since streaks, baselines and carried sick days reach forward. In practice that's a few days.
- **Each morning rebuilds the last 3 days** after the sync, which catches late watch data and completes yesterday (its evening meals, workout and journal).
- **Rule changes rebuild everything** (trigger `rebuild`): when the code that builds the state changes meaning, every day since June is rebuilt as a new version. A few hundred days take seconds.
- **No empty versions.** A rebuild is saved only when `state_hash` differs from the day's current version, so the table grows by real changes, not by rebuilds.

**Trends** read `body_state_current`. A second view can pull the common fields out of the JSON as columns (recovery score, resting HR and its usual, statuses, mood, work stress, the illness phase) for charts and the causes-and-effects measurements. It becomes a real table only if speed ever needs it.

**Size:** 6-10 KB a version, a version or two a day: a few MB a year.

**Backfill:** every day from late June (when watch data starts) built with trigger `rebuild` and no call. Areas without data that far back (meals, journal and habits before mid-September) read unknown, so the history fills in as it grows.

## When it's built

| Trigger | Builds | Makes a call |
| --- | --- | --- |
| Morning: the first health sync after last night's sleep lands | Today (version 1, or a new version), and rebuilds the 3 days before | Yes, for today, then the morning push |
| Check-in answered (journal saved) | A new version of today | Yes, with the answer |
| A report or late entry saved for a date | That date and the days after it, up to today | Only for today |
| App opened, today's current version over 3 hours old and newer data synced | A new version of today, if anything changed | Only if the facts behind the call changed |
| Rules change | Every day, as a new version | No |

The morning build needs last night's sleep. If the first sync doesn't have it, today is built as provisional (`lastNightIn: false`) without a push, and the next sync completes it.

## Morning check-in

1. The morning build finishes and makes the call.
2. **Push:** the headline plus the main reason, with the ask ("Rest today: resting HR up 3 days and recovery 38. Still feeling sick?"). One a day, between 7 am and 10 am local.
3. Tapping it opens the chat with the brief as Claude's first message: the note, and the ask.
4. The owner answers in their own words. The answer becomes the morning journal entry, plus any reports (illness, soreness).
5. Saving rebuilds the state and the call. Home and Training update.
6. No answer: Home shows the unconfirmed call with quick buttons (Feeling better, Worse today, I feel fine, I'm getting sick), each a one-tap report.

This replaces the current fixed "Morning check-in" prompt. The evening check-in stays as it is.

## Where it shows

Built October 30, 2026 (screen first; Claude's daily call and the morning push are steps 4 and 5): Today is the body-state screen (artboard 6 of https://claude.ai/artifact/5T38oJyMKqq3KZDvcahubW). From the top: the day strip shaded by each day's physical status; the check-in (`app/today-checkin.tsx`: the brief and call from `morningBrief` in `lib/body-state/brief.ts` until 5 pm, then the evening check-in; quick replies and the text box send to the chat, which drafts the journal entry); the Body card (artboard 7A: Sleep, Recovery, Strain and Fuel tiles; then each area as a short value that opens, e.g. Recovery "38 · HR 60 · HRV 52" with off numbers in red (recovery and vitals share one row on screen, since recovery is computed from them; they stay separate areas in the state); illness only when sick, easing back, showing early signs or explained; fuel among the areas with the macro bars, open on today; water quick-adds at the bottom); the timeline; goals. Opened areas chart their week (`app/charts.tsx`): vitals as resting HR and HRV small multiples on one timeline, each with its own axis, a dashed usual line and red dots on days off it; recovery as columns in its band colors; sleep as last night's stage bar (deep, REM, light, awake in shades of one blue) and 7 nights of stacked stages against the 8-hour need; load as 7 days of strain against the usual (today partial); training as days since push, pull, legs and core against the 7-day mark. The chosen day is built fresh; the strip reads stored states. The month calendar with "What happened" and the Mental and lifestyle card were built and then taken off Today the same day at the owner's request: mental and lifestyle stay in the body state for the chat and the check-in, and `whatHappened` (`lib/body-state/brief.ts`) is kept for asking about unexplained early signs from the check-in or the chat. Training's Next up takes its illness from the body state (`illnessStateOf`).

Changed the same night at the owner's request ([decisions.md](decisions.md)): Today went back to its earlier layout (score card, Nutrition card with water, timeline, 7-day tiles, goals; the day strip with sleep, recovery and strain dots). From the body state it keeps the check-in at the top (the morning brief until 5 pm, then the evening one, which has quick replies only; each goes away once it is answered), a sick line under the scores (`SickLine` in `app/body-ui.tsx`) and each score's trends, opened by tapping it (`app/score-summary.tsx`; `SleepDetails`, `RecoveryDetails`, `StrainDetails`): sleep stages and 7 nights against the 8-hour need; recovery columns in band colors, resting HR and HRV against usual, the vitals table; 7 days of strain against the usual, hard days in a row and days since rest. The Body card, its area rows and the status-shaded strip are gone; the paragraph above describes them as first built.

The plan below is the full design.

- **Home, top card:** the domain heads as one line ("Physical: low · Mental: ok · Lifestyle: good"), then the coach note (the call's `headline` and `note`), the reasons as short rows, a 7-day trend of whatever is driving the call (resting HR while sick, recovery on a low streak), and the quick buttons. It replaces the illness card.
- **Training, Next up:** the same call, with the muscle detail (out, fresh, the body map) underneath. `suggestNext` becomes the rule-based input to the call, not a second opinion.
- **Chat:** the chat knows the model (next section).

## The chat and the body state

- **System prompt** gets a "Body state" section: what the model is (domains, areas, signals, and how statuses roll up), explanations, the illness phases, the guardrails, that the owner's word wins, and that the call is made each morning. Claude explains the call from `reasons` rather than re-deriving it.
- **Tools:**
  - `get_body_state(date?)`: the current state, guardrails and call for a day (today by default).
  - `list_body_states(start, end, paths?)`: history, trimmed to the asked paths (`physical.recovery`, `mental`), for "how has my recovery been this month" or "when was I last sick". With no paths it returns each day's domain and area heads only.
  - Reports keep going through drafts the owner saves (journal with `illness`, soreness), never written directly.
- **Questions it should answer from stored states:** why today's call, what changed since this morning, when the last early warning was and whether it was right, how often he's been sick, how recovery and training load tracked over a block.

## What already exists

| Piece | Today | In the body state |
| --- | --- | --- |
| Scores | `lib/health/scores.ts`, computed per page view | `physical.sleep`, `.recovery`, `.load` |
| Illness signal | `lib/health/illness.ts` (branch `illness`) | `physical.vitals`, `physical.illness.signal` |
| Sick days | `illness_days` table (created October 30, 2026), `lib/illness-days.ts` | `physical.illness.told`, `.phase` |
| Training | `suggestNext`, `loadOf`, rules in `lib/workouts.ts` | `physical.training`, guardrails, the rule-based pick |
| Soreness | `body_log` | `physical.training.muscles[].soreness` |
| Journal | `journal_entries` | `mental.mood` |
| Habits | `habits`, `habit_logs` | `lifestyle.habits` |
| Meals, goals | `macro_entries`, `user_macro_goals` | `physical.fuel` |
| Chat health read | `get_health` (`lib/brain-health.ts`) | Stays for raw daily data; `get_body_state` for the picture |

The separate illness card, `draft_illness` cards and the Next-up illness note on branch `illness` are replaced by this.

## Build order

1. **Body state, read-only.** Built October 30, 2026: `buildBodyState` (`lib/body-state/build.ts`, tests in `tests/body-state.test.ts`), `loadBodySources` and `getBodyState` (`load.ts`), and `get_body_state` for the chat (`lib/brain-body.ts`). Until reports go through the journal (step 5), a journal entry tagged `sick` counts as a Sick day, and drinking habits are recognized by name until habits get an `affects` flag. A day type's "days since" is its middle muscle's, so lower back on a back day doesn't make legs look recent; training watches when a whole day type has gone 7+ days.
2. **Storage and backfill.** Built October 30, 2026: `body_states` and `body_state_current` (`supabase/schema.sql`), `lib/body-state/store.ts` (save a version when the state changed, upgrade on read, rebuild a day and the days after it), rebuilds after every save in `app/actions.ts` and after each health sync (cron and app open), `npm run body:states` for the backfill and full rebuilds, and `list_body_states` for the chat.
3. **Causes and effects.** The daily table view, seeded links, the weekly measurement; explanations read measured sizes when they have them.
4. **Guardrails and the call.** Guardrails, the Claude call with validation and fallback, the Home card, and Next up reading the call.
5. **Morning check-in.** Push, the chat opening with the brief, journal `illness` part, quick buttons.
6. **Tuning.** Check early warnings against reports, adjust thresholds, document the calibration in [illness.md](illness.md).

## Decided

- **Claude can change the day type**, within the guardrails, with the reason shown (October 30, 2026).
- **Habits and work stress explain numbers**, not only illness: drinking especially, and work stress (October 30, 2026). See Explanations.
- **Lifestyle grows by area:** habits, career and relationships first; more as the owner adds them.

## Journal tags speak the same language

Journal tags and the body state describe the same things, so they should share one vocabulary (agreed October 30, 2026). Today the mapping is implicit: the Work tag category feeds `lifestyle.career`, Relationships and Social feed `lifestyle.relationships`, `sick` and the symptom tags feed `physical.illness`, Sleep tags overlap `physical.sleep`, Exercise tags overlap `physical.training`.

The direction:

- **One registry of areas** (`lib/body-state/`), each with its tag keys. The journal's tag vocabulary (`TAG_CATEGORIES`) is generated from it, so adding an area adds its tags, and a new tag category means a new area or a home in an existing one.
- **Tags as signals.** Each area reads its own tags, as career and relationships do now; illness reads `sick` and symptom tags (until the journal's `illness` part replaces the guess).
- **The chat tags in area terms.** When it drafts a journal entry it picks tags from the same registry, and when it explains a day it uses the same names.
- **The planned key:value tag rework** ([journal-habits-plan.md](journal-habits-plan.md): work, social, relationship, family, health, leisure, stressor) is where this lands: each key is an area, each value a signal.

Everything is connected: work stress feeds mood, sleep and HRV, and over days the chance of getting sick. The causes-and-effects links (above) are where those connections are written down and measured, so the areas can stay separate while the links tie them together.

## Open questions

1. **Where habits live.** Kept as `lifestyle.habits` for now, since one habit often affects both body and mind; the owner wants to think about it more. The alternative is each habit under the area it affects (drinks under physical, reading under mental). Whichever wins, explanations already let a habit affect any area.
2. **Which habits explain what.** The `affects` flag on each habit: set from chat ("drinking hurts my sleep and resting HR") or the Habits tab. Drinking first.
3. **Morning timing.** When does last night's sleep usually reach Google Health? The first sync is 9 AM Eastern now. Measure arrival times from `health_sync_runs` before picking an earlier cron.
4. **Constraints.** "No gym today", "only 30 minutes", travel. Proposed for later: a `constraints` report from the check-in that the guardrails read.
5. **Sleep need.** Fixed at 8 hours; personalizing it from recent strain and debt can come later ([scores.md](scores.md)).
6. **Calls on past days.** Backfilled and rebuilt versions have no call; a day's call is on the version it was made for. Proposed: never invent calls for days the app didn't make one.
7. **Sleep consistency** (the owner's idea, October 30, 2026), as Whoop does it: how regular bed and wake times are over the last 4 nights, as a percent, in `physical.sleep`. The data is there (`bedtime`, `wake_time` in `health_daily`); it needs a status rule and a place on the Sleep row.
8. **Next areas.** Candidates: `mental.stress` (a week's stress ratings across all entries), `lifestyle.social` split out of relationships, `lifestyle.finance` (the `money` tag). Added when the owner wants them, per Adding an area.
