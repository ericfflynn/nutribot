// Caffeine and added sugar for a day (lib/nutrients.ts) and their goals (lib/goals.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackGoals, parseGoals } from "../lib/goals";
import { normalizeGeneratedMacroEstimate, parseMacroObject } from "../lib/macros";
import { caffeineDay, mealClock, sugarDay } from "../lib/nutrients";

const meal = (eatenAt: string | null, caffeine: number | null, sugar: number | null, createdAt = "2026-10-31 12:00:00+00") => ({
  entry_date: "2026-10-31",
  eaten_at: eatenAt,
  created_at: createdAt,
  caffeine_mg: caffeine,
  added_sugar_g: sugar
});

test("a day's caffeine sums its meals and knows the last one and the cutoff", () => {
  const day = caffeineDay([meal("08:00", 95, 0), meal("15:30", 150, 20), meal("19:00", 0, 10)], fallbackGoals);
  assert.equal(day.mg, 245);
  assert.equal(day.last, "15:30"); // the 7 pm meal had none
  assert.equal(day.late, true); // after 2 pm
  assert.equal(day.over, true); // over 200
  assert.equal(caffeineDay([meal("08:00", 95, 0)], fallbackGoals).late, false);
});

test("meals from before tracking are unknown, not zero", () => {
  assert.equal(caffeineDay([meal("08:00", null, null)], fallbackGoals).mg, null);
  assert.equal(sugarDay([meal("08:00", null, null)], fallbackGoals).g, null);
  // A mix counts only the meals that have it.
  assert.equal(sugarDay([meal("08:00", null, null), meal("12:00", 0, 40)], fallbackGoals).g, 40);
  assert.equal(sugarDay([meal("12:00", 0, 40)], fallbackGoals).over, true);
});

test("a meal without eaten_at uses when it was logged, only that same day", () => {
  assert.equal(mealClock(meal(null, 95, 0, "2026-10-31 13:05:00+00")), "09:05"); // EDT
  assert.equal(mealClock(meal(null, 95, 0, "2026-11-01 13:05:00+00")), null);
});

test("estimates sum caffeine and added sugar from the items", () => {
  const estimate = normalizeGeneratedMacroEstimate(
    parseMacroObject({
      items: [
        { name: "Latte", calories: 190, protein_g: 10, carbs_g: 18, fat_g: 7, caffeine_mg: 150, added_sugar_g: 15 },
        { name: "Banana", calories: 105, protein_g: 1, carbs_g: 27, fat_g: 0 }
      ]
    })
  );
  assert.equal(estimate.caffeine_mg, 150);
  assert.equal(estimate.added_sugar_g, 15);
});

test("goals keep the macros when a limit is bad", () => {
  const goals = parseGoals({ ...fallbackGoals, calories: 2500, caffeineLimitMg: Number.NaN, caffeineCutoff: "25:00", addedSugarLimitG: 30 });
  assert.equal(goals.calories, 2500);
  assert.equal(goals.caffeineLimitMg, 200);
  assert.equal(goals.caffeineCutoff, "14:00");
  assert.equal(goals.addedSugarLimitG, 30);
});
