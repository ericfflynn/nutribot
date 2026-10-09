# Daily scores: sleep, recovery, strain

The three dials on Today. Implemented in [`lib/health/scores.ts`](../lib/health/scores.ts); inputs come from the `health_daily` and `health_workouts` views.

These are **NutriBot's own estimates**, inspired by Whoop's public descriptions of its scores. Whoop's formulas are proprietary; nothing here reproduces them. The constants were chosen by judgment and calibrated by eye against about two weeks of real data (late September to early October 2026). None of it is clinically validated. Treat the scores as trend signals for one person, not measurements.

## Background

What Whoop publishes, which set the shape of these scores:

- **Strain** is 0-21, built from cardiovascular load (heart rate), on a non-linear scale where each point is harder to earn. Bands: light 0-9, moderate 10-13, strenuous 14-17, all out 18-21.
- **Recovery** is 0-100%, shown green (67-100), yellow (34-66) or red (0-33). Inputs are HRV (weighted most), resting heart rate, sleep and respiratory rate.
- Sources: [Whoop: the all-new home screen](https://www.whoop.com/us/en/thelocker/the-all-new-whoop-home-screen/), [Whoop community: how Recovery is calculated](https://www.community.whoop.com/t/what-is-the-recovery-score-and-how-is-it-calculated/107).

Strain's zone weighting follows the general TRIMP idea from sports science (training impulse: time in higher heart-rate zones counts more; Edwards' variant multiplies minutes by zone number). Recovery uses z-scores, the standard way to express "how unusual is today for this person".

## Sleep

```
sleep % = min(100, minutes asleep / 480)
```

- Input: `sleep_minutes` of the main sleep, dated by the morning you woke up.
- Need is a fixed 8 hours (`SLEEP_NEED_MINUTES`). Whoop personalizes sleep need from recent strain and sleep debt; we don't yet.

## Recovery

For the latest day that has both HRV and resting heart rate:

```
z_hrv = (today's HRV - 30-day mean HRV) / 30-day SD of HRV
z_rhr = (30-day mean RHR - today's RHR) / 30-day SD of RHR     (lower RHR is good)
physiology = clamp(60 + 25 × (0.65 × z_hrv + 0.35 × z_rhr), 1, 99)
recovery = 0.8 × physiology + 0.2 × sleep %                     (physiology alone if no sleep)
band = green ≥ 67, yellow ≥ 34, else red
```

- **Baseline:** the 30 days before the scored day; it needs at least 7 days with data (`MIN_BASELINE_DAYS`), otherwise the dial says "Needs a week of data".
- **HRV vs RHR weight (0.65 / 0.35):** Whoop says HRV matters most; the exact split is a judgment call.
- **Center at 60:** started at 50, but then an ordinary day landed mid-yellow. At 60, a typical day with full sleep scores about 68, right at the green line, and it takes a clearly worse-than-usual morning to drop into yellow.
- **25 points per SD:** a day one SD better than usual on both inputs moves physiology up 25 points.
- **Sleep at 20%:** keeps a short night visible without letting sleep swamp the physiological signal.

Example (synthetic): baseline HRV 80 ± 10 ms, RHR 62 ± 2 bpm. Today HRV 90 ms (z +1.0), RHR 61 bpm (z +0.5), 7h 30m asleep (94%).
physiology = 60 + 25 × (0.65 + 0.175) = 80.6 → recovery = 0.8 × 80.6 + 0.2 × 94 = **83%, green**.

Not used yet: respiratory rate and SpO2 (both synced), which Whoop also considers.

## Strain (the Activity dial)

```
day load     = fat-burn zone min × 1 + cardio zone min × 2 + peak zone min × 3 + steps / 1000 × 2.5
workout load = light zone min × 0.5 + moderate × 1 + vigorous × 2 + peak × 3
strain       = 21 × (1 - e^(-load / 80))          (one decimal)
band         = all out ≥ 18, strenuous ≥ 14, moderate ≥ 10, else light
```

- **Day inputs:** Fitbit's daily active-zone-minute totals (`zone_minutes_fat_burn`, `_cardio`, `_peak` in `health_daily`) and steps. These cover the whole day, not just logged workouts.
- **Workout inputs:** that session's time in Fitbit's light / moderate / vigorous / peak heart-rate zones (`hr_*_minutes` in `health_workouts`). Each workout row on Today shows its own strain.
- **Curve:** `1 - e^(-load/80)` rises quickly at first, then flattens toward 21, mimicking Whoop's diminishing returns. 21 is effectively unreachable.

Calibration history:

| Change | Why |
| --- | --- |
| Curve constant 100 → **80** | A ~50-minute weights session averaging ~130 bpm scored 9 ("light"); it should read moderate. |
| Steps 1 → **2.5** per 1,000 | An 11,000-step day with no heart-zone minutes scored about 2. |
| Light-zone workout minutes added at **0.5×** | Walks rarely leave Fitbit's light zone and scored 0. |

With these values, on the calibration data: weights sessions scored 7-11, walks 1-7, days with a weights session 12-15, easy walking days 3-6.

Example (synthetic): a day with 30 fat-burn minutes, 20 cardio minutes, 0 peak, 6,000 steps.
load = 30 + 40 + 0 + 15 = 85 → strain = 21 × (1 - e^(-1.06)) = **13.7, moderate**.

## Known limitations

- **Zones are Fitbit's.** Heart-rate zone boundaries come from Fitbit's own ranges for you (the `daily-heart-rate-zones` thresholds). Lifting that doesn't raise heart rate much scores lower than it feels.
- **Day strain ignores light-zone time outside workouts**: the daily totals don't include a light zone, so steps stand in for it.
- **Daily zone totals vs workout zones:** Fitbit reports them with different zone names (fat burn / cardio / peak for the day, light / moderate / vigorous / peak per workout); the weights map them roughly onto each other.
- **Steps are Fitbit-only**, so they're lower than the Google Health app's merged (Fitbit + iPhone) count.
- **Fixed sleep need** of 8 hours.
- **Calibrated on one person over about two weeks.** Revisit the constants after a few months of data.

## Tuning

All constants live at the top of the relevant function in `lib/health/scores.ts`:

| Constant | Effect |
| --- | --- |
| `SLEEP_NEED_MINUTES` | Sleep target |
| `MIN_BASELINE_DAYS` | Days of history before recovery is scored |
| Recovery center `60`, slope `25`, weights `0.65 / 0.35`, sleep blend `0.8 / 0.2` | How generous recovery is, and what drives it |
| `STRAIN_SCALE` (80) | Lower = strain rises faster |
| `LOAD_PER_1000_STEPS` (2.5) | How much walking counts |
| Zone weights (0.5 / 1 / 2 / 3) | How much intensity is rewarded |

To check a change against real data before shipping it, compute scores for recent days with a short script (read-only) and compare against how those days felt.

## Building on this

- **Rolling stress signal** (see [mvp-plan.md](mvp-plan.md#ideas-for-later)): accumulate day strain over several days (for example a 7-day weighted sum against a 28-day baseline, the acute:chronic workload idea), combine with journal sentiment and recovery below baseline, and remind to ease off when all point the same way.
- **Personalized sleep need**: raise the 8-hour need after high-strain days or accumulated sleep debt.
- **Respiratory rate and SpO2** as recovery inputs: flag nights well outside the personal range.
- **Score history**: store daily scores (or compute them in a view) so trends and the stress signal don't recompute everything on each page load.
