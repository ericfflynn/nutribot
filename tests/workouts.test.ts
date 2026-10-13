// Muscle names and the "Next up" strength recommendation (lib/workouts.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { activityCategoryOf, describeMuscles, normalizeMuscles, recommendNext } from "../lib/workouts";

const TODAY = "2026-10-12";

test("legacy names still read: Biceps and Abs are muscles of Arms and Core", () => {
  assert.deepEqual(describeMuscles(["Back", "Biceps", "Abs"]), ["Back", "Arms: Biceps", "Core: Abs"]);
});

test("a group listed with its own muscles keeps only the muscles", () => {
  assert.deepEqual(normalizeMuscles(["Shoulders", "Rear Delts", "Rear Delts"]), ["Rear Delts"]);
});

test("recommends the split whose muscles have waited longest", () => {
  const last = new Map([
    ["Mid Chest", "2026-10-11"],
    ["Triceps", "2026-10-11"],
    ["Legs", "2026-10-09"], // whole group counts for every leg muscle
    ["Lats", "2026-09-28"]
  ]);
  const next = recommendNext(last, TODAY);
  assert.equal(next.split, "Pull day");
  assert.equal(next.neglected[0].since, null); // Upper Back, Rear Delts or Biceps never logged
  assert.equal(next.addCore, true); // core never logged: added to the day, not a day of its own
});

test("nothing neglected when every split was hit in the last few days", () => {
  const last = new Map(["Chest", "Shoulders", "Arms", "Back", "Legs", "Core"].map((group) => [group, "2026-10-11"]));
  assert.deepEqual(recommendNext(last, TODAY), { split: null, neglected: [], addCore: false });
});

test("workout types roll up into strength, cardio, mobility and sport", () => {
  assert.equal(activityCategoryOf("strength"), "strength");
  assert.equal(activityCategoryOf("run"), "cardio");
  assert.equal(activityCategoryOf("yoga"), "mobility");
  assert.equal(activityCategoryOf("pilates"), "mobility");
  assert.equal(activityCategoryOf("sport"), "sport");
});
