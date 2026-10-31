# Decisions

Product and design decisions, newest first. One entry per decision: what was decided, why, and what it replaced or ruled out. Add an entry whenever the owner settles something that future work should follow; link the doc that holds the detail. Data shapes live in their specs ([body-state.md](body-state.md) keeps the body state's schema versions); this log says why they are what they are.

## 2026-10-30

### Temperatures show in Fahrenheit
- **Decided:** sleep temperature reads in °F everywhere it's shown (Today's vitals table, the body state's and illness detector's reasons, the chat's health lines), through `fahrenheitDelta` in `lib/health/units.ts`. Data and thresholds stay in °C, as Fitbit reports them (+0.4°C, shown as +0.7°F).
- **Why:** the owner thinks in Fahrenheit.

### Today goes back to its earlier layout, with three body-state pieces
- **Decided:** after using the Body card, the owner preferred the earlier Today: the Sleep / Recovery / Strain score card, the Nutrition card (calories, macro bars, water), the timeline, the "Last 7 days" tiles and goals, with the day strip's sleep / recovery / strain dots. Kept from the body-state screen: the check-in card at the top (morning until 5 pm, then evening; each goes away as soon as it is answered, which replaced a close button; the evening one has quick replies only, no text box, since the chat has two other entry points), each score's trends opened by tapping it (Recovery first, then Sleep and Strain at his request), and a sick line under the scores while sick, easing back or showing early signs.
- **Why:** the four small tiles didn't make his main numbers stand out, the closed area rows looked cluttered, and Load added nothing. Mockups of bigger tiles (https://claude.ai/artifact/8y8aZENqJwtXGc3wpTYsa7, options A to F) didn't win him over.
- **Instead of:** the one Body card below (tiles, area rows, Fuel as an area, water quick-adds) and the day strip shaded by status. The body state itself is unchanged and still feeds the chat, the check-in and Training.

### One Body screen: week strip, check-in, the day's state, the month
- **Decided:** the body state gets one screen, artboard 5 of https://claude.ai/artifact/5T38oJyMKqq3KZDvcahubW: a week strip shaded by status that picks the day; the morning check-in (the agent's brief and call, quick replies, a box to say more; the answer becomes the morning journal entry); the day's domains and areas, the area driving the status open with its trend and signals; the month calendar and "What happened" with Sick / Not sick / Not sure on unexplained early signs.
- **Instead of:** separate drill-down, history and check-in screens (artboards 2-4), which the owner liked individually.
- **Trimmed after use (same day):** the month calendar with "What happened", the Mental and lifestyle card and the illness row on well days came off Today; the illness row's "Watch" line repeated Vitals. Today shows the body through Physical and Fuel; mental and lifestyle stay in the body state for the chat and check-in. Asking about unexplained early signs moves to the check-in.
- **Physical and Fuel are one Body card** (artboard 7A): four tiles (Sleep, Recovery, Strain, Fuel), then short values rather than sentences ("HR 60 · HRV 52"), fuel as an area, water at the bottom. Picked over a meter list (7B) and side-by-side panels (7C).
- **Recovery and vitals share a row** on Today: recovery is a function of HRV and resting HR. They stay separate areas in the body state.
- **Placement:** it becomes the Today tab itself, with what Today has now folded in ("the body is the focus of everything"): the week strip replaces the day strip, the check-in replaces the Check-in card, the scores sit at the top of Physical, nutrition and water become the Fuel card, then mental and lifestyle, the timeline, the month, goals. Draft: artboard 6. Built screen first; Claude's morning brief and push after.

### Body state is the core model
- **Decided:** one daily picture of body and mind that every part of the app reads (Home, Training's Next up, the chat, pushes), in three levels: domains (physical, mental, lifestyle), areas, signals. [body-state.md](body-state.md).
- **Why:** each part read its own data and they disagreed: Next up suggested a hard pull day while the owner was sick and the watch showed it. Nothing was stored, so the app couldn't look back.
- **Instead of:** a separate illness card, illness chat cards and a note on Next up (built the same day and called "lame").

### Code builds the facts, Claude judges inside limits, the owner's word wins
- **Decided:** facts and guardrails are deterministic code; Claude makes the daily call and writes the note within the guardrails, validated, falling back to the rules; what the owner reports overrides what the data suggests.
- **Why:** the right call isn't always a clear rule, but some limits (no lifting while sick) must hold.

### Statuses roll up as the worst known area
- **Decided:** each area has a status (good, ok, watch, low, unknown) from simple thresholds; a domain takes its worst known area's status and headline. Ties go to illness, then recovery.
- **Instead of:** weighted scores, which the owner has preferred to avoid ("simple rules you can check in your head").

### Recovery is soft
- **Decided:** only red recovery changes the day (light only); yellow still allows hard training.

### Claude may change the day type
- **Decided:** within the guardrails and with the reason shown ("journaled knee pain, so pull instead of legs"), not just intensity and wording.

### Other causes explain the numbers before illness does
- **Decided:** drinking, a late night, a hard training stretch and work stress are explanations. One only counts when it moves what drove the signal: work stress can explain a low HRV, not a raised resting HR.
- **Why:** the first version explained a rising resting HR away as work stress while the owner was getting sick.
- **Also:** work stress, sleep debt and drinking make getting sick more likely over days; that's a cause-and-effect link to measure, not an explanation.

### Journal tags and areas share one vocabulary
- **Decided:** the journal's tag categories and the body state's areas are the same things: Work feeds career, Relationships and Social feed relationships, `sick` and symptoms feed illness. Direction: one registry of areas generates the tag vocabulary.

### Lifestyle grows by area
- **Decided:** lifestyle starts with habits, career and relationships; more areas get added as the owner wants them. Adding one takes signals, a status rule, a headline and optionally an explanation kind.
- **Open:** whether habits stay under lifestyle or move under the areas they affect.

### Being sick is reported through the journal, plus quick buttons
- **Decided:** the journal entry records illness (severity, symptoms); quick buttons on the Home card give one-tap answers. Until the journal records it, an entry tagged `sick` counts as a Sick day.
- **Instead of:** separate illness chat cards.

### The morning check-in comes from the agent
- **Decided:** after the morning sync, Claude writes the day's brief from the body state, a push asks the owner to confirm what it sees, and the answer becomes the morning journal entry and any reports.

### Stored as JSONB, versioned per day, past days change
- **Decided:** `body_states` holds the whole state as JSONB with a schema version; code reads old rows through upgrade functions. A late entry rebuilds its day and the days after it as new versions; the newest version is the day's truth, older ones are what the app believed then. Unchanged rebuilds aren't saved. Trends read each day's newest version.
- **Why:** the model is young and will change; meals, journal entries and watch data arrive late.
- **Instead of:** frozen snapshots plus a separately rebuilt trend table.

### Causes and effects are hypotheses measured from the owner's data
- **Decided:** links (cause, effect, lag, expected direction) stored as data, seeded from physiology and added by the owner or Claude with approval; code measures each weekly, compares like with like, says "too few" under 8 cases, and keeps the history.
- **Instead of:** machine learning, which needs years of data and can't show its reasons.

### Statuses calibrated against October
- **Decided:** training doesn't set the physical domain's status (it's what's due, not how the body is); recovery goes to watch only under 50 after 3+ days not green; training watches only push, pull and legs.
- **Why:** after the backfill, Physical read "watch" on 21 of 30 October days, mostly training (17) and recovery (13). A status that's always on watch says nothing.

### Training watches day types, not single muscles
- **Decided:** a day type's "days since" is its middle muscle's, and the training area goes to watch when a whole day type has gone 7+ days.
- **Why:** some single muscle was always past 7 days, so training was on watch every day; lower back worked on back day made legs look recent.

### Any soreness keeps a muscle out of Next up
- **Decided:** slight soreness counts; Next up only suggests fresh muscles. A soreness mark and a workout on the same day take the higher level.
- **Why:** a muscle marked "slight" stayed in the suggestion while the body map said recovering.

### Rest-day rules
- **Decided:** no back the day after forearms or biceps, no chest the day after triceps; those muscles show under Out with the reason ("Lats · after forearms").
- **Instead of:** a separate "Not today" line, which read as janky.
