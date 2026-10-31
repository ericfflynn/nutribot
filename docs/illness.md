# Illness

Status: built October 30, 2026. Spotting illness early from the watch, logging sick days through chat, and resting the Training plan while sick.

## Watch signal

`illnessSignal` in `lib/health/illness.ts`. When the body fights an infection, resting heart rate usually rises a day or two before or as symptoms start, often with a warmer night, lower HRV or faster breathing. Each day is compared with the owner's own baseline:

- **Baseline:** days −31 to −4 (the 3 days before are left out so a signal that's building doesn't hide itself), without logged sick days. It needs 14 days with resting HR.
- **Points for the day:**
  - Resting HR: +2 bpm (and at least twice its usual spread) is 1, +3 is 2, +5 is 3.
  - Sleep temperature, which Fitbit already gives relative to its own baseline: +0.4°C is 1, +1.0°C is 2.
  - HRV at or below 80% of its baseline median: 1.
  - Breathing rate 1 breath a minute above its baseline mean: 1.
- **Flagged:** 2 points or more, with resting HR or a +1.0°C night among them. Low HRV and a warm night alone don't flag a day.
- **Possible:** a flagged day. **Likely:** 4 points, or 3 with the day before flagged too.

Calibration: picked October 30, 2026 against the owner's data from June. The illness he had at the time showed resting HR rising a few bpm a day above a usual that varies about ±1, plus a warm night: possible for two days, likely from the third, a day or so before he said he felt sick. He didn't remember which earlier stretches were illness, so the thresholds aren't tuned to past episodes yet. On that history the signal flags about one stretch every two to three weeks, some of which are probably hard training, drinking or a short night rather than illness; resting HR also drifted up over the months, which the rolling baseline follows. Logged answers ("I feel fine" on a flagged day is a severity 0 day, a false alarm) are what to tune against next.

## Logging

Through chat only: `draft_illness` and `list_illness` (`lib/illness.ts`, prompt in `ILLNESS_PROMPT`). One card covers a day or a run of days at the same severity ("sick since Tuesday"); saving sets each day in `illness_days`, replacing what was there.

- **Severity:** 0 Better (ends an illness, and on a flagged day records a false alarm), 1 Mild (a bit off, above the neck), 2 Sick (clearly unwell, below the neck or a fever), 3 Very sick (in bed).
- **Symptoms:** a fixed list (`SYMPTOMS` in `lib/illness-days.ts`), only those mentioned; anything else goes in the note.
- **Episodes** (`episodesOf`): sick days with at most a day's gap. A day with nothing logged carries the last severity for 2 days (`CARRY_DAYS`); a Better day or 2 days without a log ends it.

## Where it shows

- **Today:** since October 30, 2026, a sick line under the day scores while sick, easing back or showing early signs (`SickLine` in `app/body-ui.tsx`, from the body state; [body-state.md](body-state.md#where-it-shows)), and the morning check-in's replies while sick. A body-state screen with illness as an area and the month's "What happened" came and went the same day. Before that: a card under the scores. While sick: severity and day number, since when, symptoms, one bar per logged day shaded by severity, what the watch shows, and Update (opens the chat). When not sick and the watch flags the day: "Possibly / Likely getting sick" with the reasons and "Feeling off?". It's hidden once anything is logged that day, and on ordinary days.
- **Training, Next up** (`suggestNext` with an `IllnessState`): Sick or Very sick is rest (no pick, no alternatives); Mild is light work only; the 2 days after an illness that reached Sick ease back with nothing hard (`EASE_DAYS`); an unanswered watch flag also means nothing hard. A line under "Next up" says why.
- **Push:** after each health sync (`sendIllnessAlert`, called from `/api/cron/health-sync`), between 7 am and 9 pm local, when the signal is likely and nothing is logged for today or yesterday: one notification ("You may be getting sick", the reasons, opening the chat with "I'm feeling sick: "), then none for 10 days. Sends are recorded in `reminder_sends` with kind `illness`. The 9 AM Eastern sync is usually the one that catches the night.

Scores are unchanged: Recovery already drops with the same signals.

## Not built yet

- Tuning the thresholds against logged false alarms and episodes.
- Sick days on the trend charts, and an episode history view.
- Skipping illness flags after a logged night of drinking.
