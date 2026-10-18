// Muscle names, intensity, weekly volume and the "Next up" strength
// recommendation (lib/workouts.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityCategoryOf,
  describeMuscles,
  intensityOf,
  loadOf,
  normalizeMuscles,
  recommendNext,
  type TrainedSession,
  weekStatus
} from "../lib/workouts";

const TODAY = "2026-10-12";

test("legacy Abs counts for Upper and Lower Abs, not Obliques", () => {
  const sessions = [session("2026-10-11", ["Abs"], 5)];
  assert.equal(loadOf(sessions, "Upper Abs", TODAY).points, 2);
  assert.equal(loadOf(sessions, "Lower Abs", TODAY).points, 2);
  assert.equal(loadOf(sessions, "Obliques", TODAY).points, 0);
});

test("legacy names still read: Biceps and Abs are muscles of Arms and Core", () => {
  assert.deepEqual(describeMuscles(["Back", "Biceps", "Abs"]), ["Back", "Arms: Biceps", "Core: Abs"]);
});

test("a group listed with its own muscles keeps only the muscles", () => {
  assert.deepEqual(normalizeMuscles(["Shoulders", "Rear Delts", "Rear Delts"]), ["Rear Delts"]);
});

const session = (date: string, names: TrainedSession["muscleGroups"], rpe: number | null, muscleIntensity = {}): TrainedSession => ({
  date,
  muscleGroups: names,
  muscleIntensity,
  rpe
});

test("a muscle's intensity is its own, then its group's, then the RPE's", () => {
  const s = session(TODAY, ["Chest", "Triceps", "Front Delts"], 8, { Chest: "light", Arms: "medium" });
  assert.equal(intensityOf(s, "Chest"), "light");
  assert.equal(intensityOf(s, "Triceps"), "medium");
  assert.equal(intensityOf(s, "Front Delts"), "hard");
  assert.equal(intensityOf(session(TODAY, ["Back"], null), "Back"), "medium"); // no RPE counts as medium
});

test("chips mark muscles with their own intensity", () => {
  assert.deepEqual(describeMuscles(["Chest", "Triceps"], { Chest: "light" }), ["Chest (light)", "Arms: Triceps"]);
});

test("weekly volume sums the last 7 days; recovery follows the latest hard work", () => {
  const sessions = [
    session("2026-10-10", ["Chest"], 8), // hard, 2 days ago: 3 points, 3 more days to recover
    session("2026-10-11", ["Upper Chest"], 3), // light, yesterday: 1 point
    session("2026-10-05", ["Chest"], 8) // 7 days ago: outside the week
  ];
  assert.deepEqual(loadOf(sessions, "Upper Chest", TODAY), { points: 4, readyIn: 3 });
  assert.deepEqual(loadOf(sessions, "Mid Chest", TODAY), { points: 3, readyIn: 3 });
  assert.deepEqual(loadOf(sessions, "Lats", TODAY), { points: 0, readyIn: 0 });
});

test("each muscle is due, recovering or covered", () => {
  const sessions = [
    session("2026-10-08", ["Mid Chest"], 8), // 3 points, recovered
    session("2026-10-11", ["Mid Chest"], 2), // +1: at target
    session("2026-10-11", ["Lats"], 8) // hard yesterday: 4 days to go
  ];
  const week = weekStatus(sessions, TODAY);
  assert.deepEqual(week.covered.map((item) => item.muscle), ["Mid Chest"]);
  assert.deepEqual(week.recovering.map((item) => [item.muscle, item.readyIn]), [["Lats", 4]]);
  assert.equal(week.due.length, 18); // the other strength muscles, none trained
});

test("RPE 1-3 is light, 4-6 medium, 7-10 hard", () => {
  assert.equal(intensityOf(session(TODAY, ["Lats"], 3), "Lats"), "light");
  assert.equal(intensityOf(session(TODAY, ["Lats"], 4), "Lats"), "medium");
  assert.equal(intensityOf(session(TODAY, ["Lats"], 7), "Lats"), "hard");
});

test("light work recovers in a day, medium in two", () => {
  assert.equal(loadOf([session("2026-10-11", ["Lats"], 3)], "Lats", TODAY).readyIn, 0);
  assert.equal(loadOf([session("2026-10-11", ["Lats"], 5)], "Lats", TODAY).readyIn, 1);
});

test("recommends the split with the most volume missing from recovered muscles", () => {
  const sessions = [session("2026-10-11", ["Mid Chest", "Triceps"], 8), session("2026-10-09", ["Legs"], 6)];
  const last = new Map([
    ["Mid Chest", "2026-10-11"],
    ["Triceps", "2026-10-11"],
    ["Legs", "2026-10-09"],
    ["Lats", "2026-09-28"]
  ]);
  const next = recommendNext(last, sessions, TODAY);
  assert.equal(next.split, "Pull day");
  assert.equal(next.neglected[0].points, 0);
  assert.equal(next.addCore, true); // core never logged: added to the day, not a day of its own
});

test("hard work still recovering is skipped even when it's short of volume", () => {
  // Pull and legs at target; push trained hard yesterday and short.
  const sessions = [
    session("2026-10-11", ["Chest", "Shoulders", "Arms"], 9),
    session("2026-10-07", ["Back", "Arms", "Shoulders", "Legs", "Core"], 8),
    session("2026-10-10", ["Back", "Arms", "Shoulders", "Legs", "Core"], 6)
  ];
  const next = recommendNext(new Map(), sessions, TODAY);
  assert.equal(next.split, null);
  assert.equal(next.rest, "recovering");
});

test("covered when every split muscle has its weekly volume", () => {
  const all: TrainedSession["muscleGroups"] = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core"];
  const sessions = [session("2026-10-06", all, 8), session("2026-10-10", all, 6)];
  assert.deepEqual(recommendNext(new Map(), sessions, TODAY), { split: null, rest: "covered", neglected: [], addCore: false });
});

test("workout types roll up into strength, cardio, mobility and sport", () => {
  assert.equal(activityCategoryOf("strength"), "strength");
  assert.equal(activityCategoryOf("run"), "cardio");
  assert.equal(activityCategoryOf("yoga"), "mobility");
  assert.equal(activityCategoryOf("pilates"), "mobility");
  assert.equal(activityCategoryOf("sport"), "sport");
});
