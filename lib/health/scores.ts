// Whoop-style daily scores computed from Fitbit data. These are NutriBot's own
// transparent estimates, not Whoop's proprietary formulas. Rationale,
// calibration history and limitations: docs/scores.md (keep it in sync).
import { addDays } from "../dates";
import type { HealthDay, HealthWorkout } from "./queries";

export const SLEEP_NEED_MINUTES = 8 * 60;
// Days of personal history needed before recovery is scored.
const MIN_BASELINE_DAYS = 7;

export type RecoveryBand = "green" | "yellow" | "red";

export type RecoveryScore = {
  score: number;
  band: RecoveryBand;
  day: string;
};

function stats(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Whoop's bands: green 67-100, yellow 34-66, red 0-33.
export function recoveryBand(score: number): RecoveryBand {
  return score >= 67 ? "green" : score >= 34 ? "yellow" : "red";
}

// Recovery for the latest day with HRV and resting heart rate:
//   1. z-scores against the previous 30 days: HRV above baseline is good,
//      resting heart rate below baseline is good.
//   2. physiology = 60 + 25 * (0.65 * z_hrv + 0.35 * z_rhr), clamped to 1-99
//      (HRV weighted most, as Whoop describes; a typical day centers at 60 so
//      a normal day with full sleep lands near the green line).
//   3. recovery = 80% physiology + 20% that night's sleep score (sleepOn).
// Returns null until there are MIN_BASELINE_DAYS of history.
export function recoveryScore(days: HealthDay[], sleepOn: (date: string) => number | null): RecoveryScore | null {
  const index = days.map((day) => day.hrvMs != null && day.restingHr != null).lastIndexOf(true);
  if (index < 0) {
    return null;
  }
  const history = days.slice(Math.max(0, index - 30), index);
  const hrvHistory = history.map((day) => day.hrvMs).filter((value): value is number => value != null);
  const rhrHistory = history.map((day) => day.restingHr).filter((value): value is number => value != null);
  if (hrvHistory.length < MIN_BASELINE_DAYS || rhrHistory.length < MIN_BASELINE_DAYS) {
    return null;
  }

  const today = days[index];
  const hrv = stats(hrvHistory);
  const rhr = stats(rhrHistory);
  const zHrv = hrv.sd > 0 ? ((today.hrvMs as number) - hrv.mean) / hrv.sd : 0;
  const zRhr = rhr.sd > 0 ? (rhr.mean - (today.restingHr as number)) / rhr.sd : 0;
  const physiology = clamp(60 + 25 * (0.65 * zHrv + 0.35 * zRhr), 1, 99);

  const sleep = sleepOn(today.day);
  const score = Math.round(sleep == null ? physiology : 0.8 * physiology + 0.2 * sleep);
  return { score, band: recoveryBand(score), day: today.day };
}

// ---------- Sleep ----------
// Sleep score = 70% duration (asleep / tonight's need, capped at 100) + 30%
// consistency (a Sleep Regularity Index over 7 nights). Need starts at the
// 8-hour baseline and rises after a hard day, a run of short nights or a sick
// day, up to 9.5 hours. Rationale and calibration: docs/scores.md.
const NEED_CAP_MINUTES = 9.5 * 60;
const STRAIN_NEED_FROM = 10; // yesterday's strain above this adds need
const STRAIN_NEED_PER_POINT = 3;
const STRAIN_NEED_MAX = 30;
const DEBT_REPAY_SHARE = 0.25; // an hour of debt is repaid over about 4 nights
const DEBT_NEED_MAX = 60;
const SICK_NEED_MINUTES = 45;
const DURATION_WEIGHT = 0.7;
const CONSISTENCY_NIGHTS = 7;
const CONSISTENCY_MIN_NIGHTS = 5;

export type SleepNeed = { minutes: number; baseline: number; strain: number; debt: number; illness: number };

export type SleepScore = {
  score: number;
  minutes: number; // asleep
  durationPct: number; // asleep / need, capped at 100
  consistency: number | null; // 0-100, null under 5 of 7 nights
  need: SleepNeed;
};

export function sleepNeed({ strainYesterday, debtMinutes, sick }: { strainYesterday: number | null; debtMinutes: number; sick: boolean }): SleepNeed {
  const strain = Math.round(Math.min(STRAIN_NEED_MAX, Math.max(0, STRAIN_NEED_PER_POINT * ((strainYesterday ?? 0) - STRAIN_NEED_FROM))));
  const debt = Math.round(Math.min(DEBT_NEED_MAX, DEBT_REPAY_SHARE * debtMinutes));
  const illness = sick ? SICK_NEED_MINUTES : 0;
  const minutes = Math.min(NEED_CAP_MINUTES, SLEEP_NEED_MINUTES + strain + debt + illness);
  return { minutes, baseline: SLEEP_NEED_MINUTES, strain, debt, illness };
}

// Debt is a running balance against the 8-hour baseline, oldest night first:
// a short night adds its shortfall, a long one pays it down, never below 0.
// Measured against the baseline, not each night's raised need, so a raised
// need can't feed on itself.
export function sleepDebt(nightsOldestFirst: readonly (number | null)[]) {
  return nightsOldestFirst.reduce<number>((balance, minutes) => (minutes == null ? balance : Math.max(0, balance + SLEEP_NEED_MINUTES - minutes)), 0);
}

// Clock time as minutes after 6 pm, so a bedtime after midnight sorts after one before.
const eveningMinutes = (timestamp: string) => {
  const [h, m] = timestamp.slice(11, 16).split(":").map(Number);
  return (h * 60 + m - 18 * 60 + 1440) % 1440;
};

// A Sleep Regularity Index (Phillips et al. 2017) from the main sleep's bed
// and wake times: for each pair of nights a day apart, the share of the 24
// hours spent in the same state (asleep or awake), scaled so identical nights
// are 100 and unrelated ones 0. Wake-ups in the night are counted as asleep,
// so it runs a little high. `nights` are consecutive, oldest first, null
// where there's no data; it needs CONSISTENCY_MIN_NIGHTS with times.
export function sleepConsistency(nights: readonly ({ bedtime: string | null; wakeTime: string | null } | null)[]): number | null {
  const spans = nights.map((night) => {
    if (!night?.bedtime || !night.wakeTime) return null;
    const start = eveningMinutes(night.bedtime);
    let end = eveningMinutes(night.wakeTime);
    if (end <= start) end += 1440;
    return { start, end };
  });
  if (spans.filter(Boolean).length < CONSISTENCY_MIN_NIGHTS) return null;
  const asleep = (span: { start: number; end: number }, minute: number) =>
    (minute >= span.start && minute < span.end) || (minute + 1440 >= span.start && minute + 1440 < span.end);
  const pairs: number[] = [];
  for (let index = 1; index < spans.length; index += 1) {
    const [a, b] = [spans[index - 1], spans[index]];
    if (!a || !b) continue;
    let same = 0;
    for (let minute = 0; minute < 1440; minute += 1) if (asleep(a, minute) === asleep(b, minute)) same += 1;
    pairs.push((200 * same) / 1440 - 100);
  }
  if (pairs.length < CONSISTENCY_MIN_NIGHTS - 2) return null;
  return Math.max(0, Math.round(pairs.reduce((sum, value) => sum + value, 0) / pairs.length));
}

// The sleep score for the night that ended on `date`. Null when it hasn't synced.
export function sleepScore(
  byDay: ReadonlyMap<string, HealthDay>,
  date: string,
  { strainYesterday, sick }: { strainYesterday: number | null; sick: boolean }
): SleepScore | null {
  const minutes = byDay.get(date)?.sleepMinutes ?? null;
  if (minutes == null) return null;
  const before = Array.from({ length: 7 }, (_, index) => byDay.get(addDays(date, index - 7))?.sleepMinutes ?? null);
  const need = sleepNeed({ strainYesterday, debtMinutes: sleepDebt(before), sick });
  const durationPct = Math.min(100, Math.round((minutes / need.minutes) * 100));
  const consistency = sleepConsistency(
    Array.from({ length: CONSISTENCY_NIGHTS }, (_, index) => byDay.get(addDays(date, index - CONSISTENCY_NIGHTS + 1)) ?? null)
  );
  const score = Math.round(consistency == null ? durationPct : DURATION_WEIGHT * durationPct + (1 - DURATION_WEIGHT) * consistency);
  return { score, minutes, durationPct, consistency, need };
}

// Sleep scores for `dates`, with yesterday's day strain from its workouts.
export function sleepScoresFor(
  days: readonly HealthDay[],
  dates: readonly string[],
  workoutsByDay: ReadonlyMap<string, readonly HealthWorkout[]>,
  sickDates: ReadonlySet<string>
) {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const scores = new Map<string, SleepScore>();
  for (const date of dates) {
    const yesterday = addDays(date, -1);
    const score = sleepScore(byDay, date, { strainYesterday: dayStrain(byDay.get(yesterday), workoutsByDay.get(yesterday)), sick: sickDates.has(date) || sickDates.has(yesterday) });
    if (score) scores.set(date, score);
  }
  return scores;
}

// Strain, Whoop-style: 0-21, driven by heart-rate intensity. Load weights
// minutes in higher heart-rate zones more heavily (light 0.5x, moderate or
// fat-burn 1x, vigorous or cardio 2x, peak 3x); steps add 2.5 per 1,000 so a
// long walking day still registers. The curve flattens toward 21, so each
// extra point takes more effort (a solid hour of training lands ~11-14).
const STRAIN_MAX = 21;
const STRAIN_SCALE = 80;
const LOAD_PER_1000_STEPS = 2.5;

export type StrainBand = "Light" | "Moderate" | "Strenuous" | "All out";

function strainFromLoad(load: number) {
  return Math.round(STRAIN_MAX * (1 - Math.exp(-load / STRAIN_SCALE)) * 10) / 10;
}

// Whoop's bands: light 0-9, moderate 10-13, strenuous 14-17, all out 18-21.
export function strainBand(strain: number): StrainBand {
  return strain >= 18 ? "All out" : strain >= 14 ? "Strenuous" : strain >= 10 ? "Moderate" : "Light";
}

// Day strain is the sum of its parts: every workout's load, plus what the
// rest of the day added. The rest is Fitbit's daily heart-zone minutes (fat
// burn, cardio, peak) less the workouts' own (moderate, vigorous, peak), and
// steps taken outside workouts. So a day never scores below a workout in it.
// `workouts` are that day's watch workouts.
export function dayStrain(day: HealthDay | undefined, workouts: readonly HealthWorkout[] = []) {
  if (!day || (day.zoneMinutesFatBurn == null && day.steps == null)) {
    return null;
  }
  const sum = (field: (workout: HealthWorkout) => number | null) =>
    workouts.reduce((total, workout) => total + (field(workout) ?? 0), 0);
  const outside = (dayMinutes: number | null, workoutMinutes: number) => Math.max(0, (dayMinutes ?? 0) - workoutMinutes);
  const load =
    sum(workoutLoad) +
    outside(day.zoneMinutesFatBurn, sum((w) => w.hrModerateMinutes)) +
    2 * outside(day.zoneMinutesCardio, sum((w) => w.hrVigorousMinutes)) +
    3 * outside(day.zoneMinutesPeak, sum((w) => w.hrPeakMinutes)) +
    (outside(day.steps, sum((w) => w.steps)) / 1000) * LOAD_PER_1000_STEPS;
  return strainFromLoad(load);
}

// Session-RPE load (RPE × minutes) per unit of heart-rate load. At 0.2 an
// RPE 6 session matches its heart-rate load on the owner's data (heart-rate
// load runs about 1.2 × minutes whatever the effort), so harder sessions
// score above their heart rate and easier ones below.
const RPE_LOAD_SCALE = 0.2;
// Share of a logged workout's load that comes from perceived effort.
const RPE_WEIGHT = 0.5;

// A workout's load: time in each heart-rate zone, blended with perceived
// effort (RPE × minutes) when the workout was logged with an RPE. Heart rate
// alone misses lifting that feels hard without raising it much. Null with no
// zone data.
function workoutLoad(workout: HealthWorkout) {
  const zones = [workout.hrLightMinutes, workout.hrModerateMinutes, workout.hrVigorousMinutes, workout.hrPeakMinutes];
  if (zones.every((minutes) => minutes == null)) {
    return null;
  }
  const heartRate =
    0.5 * (workout.hrLightMinutes ?? 0) +
    (workout.hrModerateMinutes ?? 0) +
    2 * (workout.hrVigorousMinutes ?? 0) +
    3 * (workout.hrPeakMinutes ?? 0);
  if (workout.rpe == null || workout.activeMinutes == null) {
    return heartRate;
  }
  const effort = RPE_LOAD_SCALE * workout.rpe * workout.activeMinutes;
  return (1 - RPE_WEIGHT) * heartRate + RPE_WEIGHT * effort;
}

// Workout strain from heart-rate zones and, when logged, perceived effort.
export function workoutStrain(workout: HealthWorkout) {
  const load = workoutLoad(workout);
  return load == null ? null : strainFromLoad(load);
}

// The day's workouts together, on the same 0-21 curve: the part of day
// strain they account for. Null with no workout zone data.
export function workoutsStrain(workouts: readonly HealthWorkout[]) {
  const loads = workouts.map(workoutLoad).filter((load): load is number => load != null);
  return loads.length ? strainFromLoad(loads.reduce((sum, load) => sum + load, 0)) : null;
}
