// Whoop-style daily scores computed from Fitbit data. These are NutriBot's own
// transparent estimates, not Whoop's proprietary formulas.
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
//   3. recovery = 80% physiology + 20% sleep performance (asleep / 8h need).
// Returns null until there are MIN_BASELINE_DAYS of history.
export function recoveryScore(days: HealthDay[]): RecoveryScore | null {
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

  const sleep = sleepPerformance(today.sleepMinutes);
  const score = Math.round(sleep == null ? physiology : 0.8 * physiology + 0.2 * sleep);
  return { score, band: recoveryBand(score), day: today.day };
}

// Minutes asleep as a percentage of the 8-hour need, capped at 100.
export function sleepPerformance(minutesAsleep: number | null) {
  return minutesAsleep == null ? null : Math.min(100, Math.round((minutesAsleep / SLEEP_NEED_MINUTES) * 100));
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

// Day strain from Fitbit's daily heart-zone minutes (fat burn, cardio, peak) and steps.
export function dayStrain(day: HealthDay | undefined) {
  if (!day || (day.zoneMinutesFatBurn == null && day.steps == null)) {
    return null;
  }
  const load =
    (day.zoneMinutesFatBurn ?? 0) +
    2 * (day.zoneMinutesCardio ?? 0) +
    3 * (day.zoneMinutesPeak ?? 0) +
    ((day.steps ?? 0) / 1000) * LOAD_PER_1000_STEPS;
  return strainFromLoad(load);
}

// Workout strain from time in each heart-rate zone.
export function workoutStrain(workout: HealthWorkout) {
  const zones = [workout.hrLightMinutes, workout.hrModerateMinutes, workout.hrVigorousMinutes, workout.hrPeakMinutes];
  if (zones.every((minutes) => minutes == null)) {
    return null;
  }
  const load =
    0.5 * (workout.hrLightMinutes ?? 0) +
    (workout.hrModerateMinutes ?? 0) +
    2 * (workout.hrVigorousMinutes ?? 0) +
    3 * (workout.hrPeakMinutes ?? 0);
  return strainFromLoad(load);
}
