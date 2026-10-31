// Daily targets: calories with a macro split, water, and limits for caffeine
// and added sugar. Stored in user_macro_goals, one row per user.
export type Goals = {
  calories: number;
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
  waterOz: number;
  caffeineLimitMg: number; // the most that's OK in a day
  caffeineCutoff: string; // local "HH:MM": caffeine after it is late, for sleep
  addedSugarLimitG: number;
};

export const fallbackGoals: Goals = {
  calories: 2200,
  proteinPct: 30,
  carbsPct: 40,
  fatPct: 30,
  waterOz: 100,
  caffeineLimitMg: 200,
  caffeineCutoff: "14:00",
  addedSugarLimitG: 36
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Rounds the inputs and rescales the macro percents to sum to 100.
export function parseGoals(input: Goals): Goals {
  const parsed = {
    calories: Math.max(1, Math.round(Number(input.calories))),
    proteinPct: Math.max(0, Math.round(Number(input.proteinPct))),
    carbsPct: Math.max(0, Math.round(Number(input.carbsPct))),
    fatPct: Math.max(0, Math.round(Number(input.fatPct))),
    waterOz: Math.max(1, Math.round(Number(input.waterOz)))
  };
  // Limits fall back one by one, so a bad caffeine entry keeps the macros.
  const limit = (value: number, fallback: number) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value)) : fallback);
  const extras = {
    caffeineLimitMg: limit(input.caffeineLimitMg, fallbackGoals.caffeineLimitMg),
    caffeineCutoff: HHMM.test(String(input.caffeineCutoff ?? "")) ? input.caffeineCutoff : fallbackGoals.caffeineCutoff,
    addedSugarLimitG: limit(input.addedSugarLimitG, fallbackGoals.addedSugarLimitG)
  };
  if (!Object.values(parsed).every(Number.isFinite)) {
    return { ...fallbackGoals, ...extras };
  }

  const total = parsed.proteinPct + parsed.carbsPct + parsed.fatPct;
  if (total <= 0) {
    return { ...fallbackGoals, ...extras, calories: parsed.calories, waterOz: parsed.waterOz };
  }
  const proteinPct = Math.round((parsed.proteinPct / total) * 100);
  const carbsPct = Math.round((parsed.carbsPct / total) * 100);
  return { ...parsed, ...extras, proteinPct, carbsPct, fatPct: Math.max(0, 100 - proteinPct - carbsPct) };
}

export function gramsFromPercentGoals(goals: Goals) {
  return {
    protein_g: Math.round((goals.calories * (goals.proteinPct / 100)) / 4),
    carbs_g: Math.round((goals.calories * (goals.carbsPct / 100)) / 4),
    fat_g: Math.round((goals.calories * (goals.fatPct / 100)) / 9)
  };
}

// Workouts raise the day's calorie target by what they burned beyond resting:
// the watch's workout calories are total burn, so the minutes' resting burn
// comes off. The macro split stays the same, so gram targets grow with it.
// Ignored workouts (accidental recordings) don't count.
const FALLBACK_RESTING_KCAL_PER_MIN = 1.25;
const RESTING_BASELINE_DAYS = 30;

// The median resting burn per minute ((total - active) / 1440) over full days
// before `date`, from Fitbit's daily totals.
export function restingKcalPerMinute(
  days: readonly { day: string; totalKcal: number | null; activeKcal: number | null }[],
  date: string
) {
  const rates = days
    .filter((day) => day.day < date && day.totalKcal != null && day.activeKcal != null && day.totalKcal > day.activeKcal)
    .slice(-RESTING_BASELINE_DAYS)
    .map((day) => (day.totalKcal! - day.activeKcal!) / 1440)
    .sort((a, b) => a - b);
  return rates.length ? rates[Math.floor(rates.length / 2)] : FALLBACK_RESTING_KCAL_PER_MIN;
}

export function workoutCalories(
  workouts: readonly { calories: number | null; activeMinutes: number | null; ignored: boolean }[],
  restingPerMinute: number
) {
  return Math.round(
    workouts
      .filter((workout) => !workout.ignored)
      .reduce((sum, workout) => sum + Math.max(0, (workout.calories ?? 0) - restingPerMinute * (workout.activeMinutes ?? 0)), 0)
  );
}

export function withWorkoutCalories(goals: Goals, extra: number): Goals {
  return { ...goals, calories: goals.calories + extra };
}
