// Workout calories added to the day's target (lib/goals.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackGoals, restingKcalPerMinute, withWorkoutCalories, workoutCalories } from "../lib/goals";

test("resting burn is the median of earlier full days", () => {
  const days = [
    { day: "2026-10-10", totalKcal: 2240, activeKcal: 440 }, // 1.25/min
    { day: "2026-10-11", totalKcal: 2600, activeKcal: 440 }, // 1.5/min
    { day: "2026-10-12", totalKcal: 1880, activeKcal: 440 }, // 1.0/min
    { day: "2026-10-13", totalKcal: 900, activeKcal: 100 } // today, partial: left out
  ];
  assert.equal(restingKcalPerMinute(days, "2026-10-13"), 1.25);
  assert.equal(restingKcalPerMinute([], "2026-10-13"), 1.25); // fallback
});

test("workouts add what they burned beyond resting; ignored ones add nothing", () => {
  const workouts = [
    { calories: 660, activeMinutes: 120, ignored: false }, // golf: 660 - 150 = 510
    { calories: 6, activeMinutes: 1, ignored: true },
    { calories: 10, activeMinutes: 20, ignored: false } // below resting: 0, not negative
  ];
  assert.equal(workoutCalories(workouts, 1.25), 510);
  assert.equal(withWorkoutCalories(fallbackGoals, 510).calories, fallbackGoals.calories + 510);
});
