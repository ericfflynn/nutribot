// Caffeine and added sugar for a day, from its saved meals (docs/decisions.md,
// Oct 31, 2026). Meals saved before then have neither, so a day of only older
// meals is unknown (null), never zero.
import type { Goals } from "./goals";
import { localDateTime } from "./dates";
import type { MacroEntry } from "./supabase";

type Meal = Pick<MacroEntry, "entry_date" | "eaten_at" | "created_at" | "caffeine_mg" | "added_sugar_g">;

// When a meal was had, local "HH:MM": eaten_at, or when it was logged if that
// was the same day. Null when there's no way to tell.
export function mealClock(meal: Meal): string | null {
  if (meal.eaten_at) return meal.eaten_at;
  const logged = new Date(meal.created_at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(logged.getTime())) return null;
  const local = localDateTime(logged);
  return local.slice(0, 10) === meal.entry_date ? local.slice(11, 16) : null;
}

export type CaffeineDay = {
  mg: number | null;
  limitMg: number;
  cutoff: string; // "HH:MM"
  last: string | null; // "HH:MM" of the latest meal with caffeine
  over: boolean;
  late: boolean; // any caffeine after the cutoff
};

export type SugarDay = { g: number | null; limitG: number; over: boolean };

export function caffeineDay(meals: Meal[], goals: Pick<Goals, "caffeineLimitMg" | "caffeineCutoff">): CaffeineDay {
  const known = meals.filter((meal) => meal.caffeine_mg != null);
  const mg = known.length ? known.reduce((sum, meal) => sum + Number(meal.caffeine_mg), 0) : null;
  const times = known
    .filter((meal) => Number(meal.caffeine_mg) > 0)
    .map(mealClock)
    .filter((time): time is string => time != null)
    .sort();
  const last = times.at(-1) ?? null;
  return {
    mg,
    limitMg: goals.caffeineLimitMg,
    cutoff: goals.caffeineCutoff,
    last,
    over: mg != null && mg > goals.caffeineLimitMg,
    late: last != null && last > goals.caffeineCutoff
  };
}

export function sugarDay(meals: Meal[], goals: Pick<Goals, "addedSugarLimitG">): SugarDay {
  const known = meals.filter((meal) => meal.added_sugar_g != null);
  const g = known.length ? known.reduce((sum, meal) => sum + Number(meal.added_sugar_g), 0) : null;
  return { g, limitG: goals.addedSugarLimitG, over: g != null && g > goals.addedSugarLimitG };
}
