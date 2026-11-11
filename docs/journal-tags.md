# Journal tags

Status: built November 10, 2026 (feedback d9344d23, second half; ailments are the first, [ailments.md](ailments.md)). Code: `lib/journal-tags.ts` (the registry, parsing, normalizing), read by the chat (`draft_journal`), the Habits tab's Journal card and the body state's lifestyle and mental areas.

## Why

Free tags drifted: 33 entries carried 30 different tags, many repeating what other data already had (`workout`, `tired`, `good sleep`, `sore legs`), and the most used, `work`, said nothing. The areas that read them (`lifestyle.career`, `lifestyle.relationships`) were only as good as that.

## What the research says

Researched November 10, 2026:

- **Trackers split how you felt from what happened.** Daylio pairs a mood scale with activity tags; Bearable calls the second half "factors" (anything outside mood, emotions, sleep, symptoms and energy) and shows how they line up; Exist treats a tag as a yes or no for the day. NutriBot's ratings, watch and ailments already hold how the owner felt, so tags only say what happened.
- **Few tags, one meaning each.** Bearable advises tracking as few factors as possible, and specific people over a general "social event". Ranking tags by mood on the days they appear only works when a tag means the same thing every time.
- **A day is what you did and who you were with, and how each felt.** The Day Reconstruction Method (Kahneman et al., 2004) records each episode of a day by activity and interaction partners, then how that episode felt; who you were with mattered a lot.
- **Daily stressors fall into a few kinds.** The Daily Inventory of Stressful Events (Almeida et al., 2002): arguments and tension with people (the most common, and predictive of mood and physical symptoms), work, home, things happening to someone close, other.

## Shape

A tag is a key, a value, and optionally how it felt, stored in `journal_entries.tags` as text:

| Stored | Means | Shown |
| --- | --- | --- |
| `with:partner` | Time with their partner | With partner |
| `work:deadline-` | A deadline, and it felt bad | Work: deadline · felt bad |
| `did:game+` | Went to a game, felt good | Did: game · felt good |
| `work-` | Work felt bad, nothing more specific | Work · felt bad |
| `stressor:money` | Money was behind the stress | Stress from money |

- **The keys are fixed** (`TAG_KEYS`); each belongs to a body-state area. A new key means a new area or a home in one, per [Adding an area](body-state.md#adding-an-area).
- **Values are suggestions.** The chat reuses the owner's earlier values before a new word; values are cleaned and folded (synonyms, plurals) on save and on read.
- **Feeling is optional and only from their words** ("work is seeming dreadful" is `work-`; "golf with Tom was nice" is `with:tom+`). A key alone needs a feeling.
- **Why feelings are on tags.** The first version (agreed October 17) kept tags neutral, with feelings in the ratings. Retagging the owner's history showed what that loses: November 8 was a good day (mood 4) with work feeling dreadful, and one overall rating can't hold both. The owner didn't want an exception for work on day one, so feelings became part of every tag, as the Day Reconstruction Method does (November 10, 2026).
- **Nothing other data has:** no tags for workouts, meals, drinks and other habits, sleep, soreness, ailments or the ratings. At most five per entry.
- Older free tags that don't parse are dropped on read.

## The keys

| Key | Answers | Usual values | Area |
| --- | --- | --- | --- |
| `with` | Who they were with: partner and family by role, anyone else by first name | partner, family, friends, coworkers, alone | `lifestyle.relationships` |
| `did` | Something notable other data doesn't cover | ate out, date, party, event, hosting, travel, game, watched sports, outdoors, tv, side project, doctor, errands | `lifestyle` (stored; an area when wanted) |
| `work` | What work was like | deadline, meeting, presentation, launch, office, busy, after hours, day off | `lifestyle.career` |
| `stressor` | What was behind stress, only when they say | work, relationship, family, money, health, home, someone close, personal | `mental.mood` |

## What reads them

- **`lifestyle.career`:** entries with a `work` tag or `stressor:work`. **Low** with stress 5 on a work day in 3 days, or stress from work 3 days running; **watch** with work stress 4+ in 3 days, or work feeling bad on 3 of the last 7 days; **good** when work felt good more days than bad; otherwise **ok**. `feel7` counts the good and bad days.
- **`lifestyle.relationships`:** `with` tags other than alone and coworkers. **Watch** when time with someone felt bad, or stress came from the relationship or family, in the last 3 days; **good** when time with someone felt good or came with mood 4+; otherwise **ok**. `social7` counts days with someone other than partner or family.
- **`mental.mood`:** high stress names its source ("Stress 4 from money").
- **Causes and effects** (later): one column per key and value, so "HRV after `did:party` nights" and "mood on `with:friends` days" are queries.

## Habits tab

The Journal card groups tags by key: All, Felt good, Felt bad and each value, with counts; picking one shows those entries with average mood and stress against the rest. The entry editor picks a key, optionally a feeling, then a value (or the key as a whole with a feeling, or a typed value).

## Moving old tags

November 10, 2026: the owner's 33 entries were retagged by hand from their text (a one-time script kept out of the repo, with a dry run first). 18 got tags; 15 got none, since what they talked about is soreness, illness, habits, workouts, sleep or ratings. The demo user's seed data uses the new tags.
