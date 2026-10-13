// Editing habit entries and habit frequency (lib/habits.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { habitOutcome, normalizeDays, planHabitLogEdit, summarizeHabitDay, type Habit, type HabitLog } from "../lib/habits";

const reading: Habit = {
  id: "h-read",
  name: "Reading",
  description: null,
  measure: "minutes",
  unit: null,
  direction: "build",
  scaleGuide: null,
  goal: 15,
  cutoff: null,
  cutoffWeeknights: false,
  days: [1, 2, 3, 4, 5], // weekdays
  active: true
};

const drinks: Habit = { ...reading, id: "h-drinks", name: "Alcohol", measure: "count", unit: "drinks", direction: "limit", goal: 1, days: null };

function log(id: string, habit: Habit, date: string, amount: number): HabitLog {
  return { id, habitId: habit.id, date, amount, details: null, startedAt: null, endedAt: null, createdAt: `${date} 20:00` };
}

test("editing a use onto a day with a 'none' replaces the none, not duplicates", () => {
  const plan = planHabitLogEdit({ amount: 2 }, "edited", [
    { id: "none", amount: 0 },
    { id: "edited", amount: 1 }
  ]);
  assert.deepEqual(plan, { removeIds: ["none"] });
});

test("editing an entry to 'none' on a day that has a use is refused", () => {
  const plan = planHabitLogEdit({ amount: 0 }, "edited", [{ id: "use", amount: 2 }]);
  assert.ok("error" in plan);
});

test("editing an entry in place never touches itself", () => {
  assert.deepEqual(planHabitLogEdit({ amount: 0 }, "edited", [{ id: "edited", amount: 3 }]), { removeIds: [] });
  assert.deepEqual(planHabitLogEdit({ amount: 3 }, "edited", [{ id: "edited", amount: 0 }]), { removeIds: [] });
});

test("outcomes are recomputed from the edited logs", () => {
  const date = "2026-10-12"; // a Monday
  const before = summarizeHabitDay([drinks], date, [log("a", drinks, date, 3)])[0];
  assert.equal(habitOutcome(before), "miss-2");
  const after = summarizeHabitDay([drinks], date, [log("a", drinks, date, 1)])[0];
  assert.equal(habitOutcome(after), "met");
});

test("a day off the habit's frequency is 'off', not missed", () => {
  const saturday = "2026-10-10";
  const monday = "2026-10-12";
  assert.equal(habitOutcome(summarizeHabitDay([reading], saturday, [])[0]), "off");
  assert.equal(habitOutcome(summarizeHabitDay([reading], monday, [])[0]), "unknown");
  // Reading on a day off is a bonus.
  assert.equal(habitOutcome(summarizeHabitDay([reading], saturday, [log("r", reading, saturday, 20)])[0]), "met");
});

test("days normalize to sorted weekdays, or null for every day", () => {
  assert.deepEqual(normalizeDays([5, 1, 3, 3]), [1, 3, 5]);
  assert.equal(normalizeDays([0, 1, 2, 3, 4, 5, 6]), null);
  assert.equal(normalizeDays([]), null);
  assert.equal(normalizeDays(null), null);
});

test("one of a counted unit reads singular", async () => {
  const { formatHabitAmount } = await import("../lib/habits");
  assert.equal(formatHabitAmount({ measure: "count", unit: "drinks" }, 1), "1 drink");
  assert.equal(formatHabitAmount({ measure: "count", unit: "drinks" }, 2), "2 drinks");
});
