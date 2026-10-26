// Muscle names, intensity, weekly volume and the "Next up" plan
// (lib/workouts.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityCategoriesOf,
  activityCategoryOf,
  chooseMatch,
  currentMuscles,
  describeMuscles,
  groupDayIntensity,
  intensityOf,
  loadOf,
  muscleWeekOf,
  type SorenessReport,
  normalizeMuscles,
  suggestNext,
  splitOf,
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

test("weekly volume sums the last 7 days; soreness fades from the latest hard work", () => {
  const sessions = [
    session("2026-10-10", ["Chest"], 8), // hard, 2 days ago: 3 points, very sore fading to 1.5
    session("2026-10-11", ["Upper Chest"], 3), // light, yesterday: 1 point (an old name for Chest)
    session("2026-10-05", ["Chest"], 8) // 7 days ago: outside the week
  ];
  assert.deepEqual(loadOf(sessions, "Chest", TODAY), { points: 4, soreness: 1.5, readyIn: 2 });
  assert.deepEqual(loadOf(sessions, "Lats", TODAY), { points: 0, soreness: 0, readyIn: 0 });
});

test("each muscle is due, recovering or covered", () => {
  const sessions = [
    session("2026-10-08", ["Chest"], 8), // 3 points, recovered
    session("2026-10-11", ["Chest"], 2), // +1: at target
    session("2026-10-11", ["Lats"], 8) // hard yesterday: 3 days to go
  ];
  const week = weekStatus(sessions, TODAY);
  assert.deepEqual(week.covered.map((item) => item.muscle), ["Chest"]);
  assert.deepEqual(week.recovering.map((item) => [item.muscle, item.readyIn]), [["Lats", 3]]);
  assert.equal(week.due.length, 16); // the other 16 tracked muscles, none trained
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

test("suggests the day type with the most fresh, due muscles", () => {
  // Push 2 days ago and legs 3 days ago: neither due. Back never logged.
  const sessions = [session("2026-10-10", ["Chest", "Shoulders", "Triceps"], 8), session("2026-10-09", ["Legs"], 8)];
  const next = suggestNext(sessions, TODAY);
  assert.equal(next.pick?.name, "Pull day");
  assert.ok(next.pick?.work.some((item) => item.muscle === "Lats" && item.intensity === "hard"));
  assert.deepEqual(next.after, ["Leg day", "Push day"]);
});

test("a muscle is due 4 days after its last medium or hard work; light work isn't a hit", () => {
  const sessions = [session("2026-10-08", ["Legs"], 5), session("2026-10-10", ["Chest", "Back", "Shoulders", "Arms"], 8)];
  assert.equal(suggestNext(sessions, TODAY).pick?.name, "Leg day");
  assert.equal(suggestNext([...sessions, session("2026-10-11", ["Legs"], 2)], TODAY).pick?.name, "Leg day");
});

test("not a strict split: an arm day when only arms are due", () => {
  const sessions = [
    session("2026-10-09", ["Chest", "Front Delts", "Side Delts", "Rear Delts", "Lats", "Upper Back", "Traps", "Lower Back", "Legs", "Core"], 5),
    session("2026-10-01", ["Arms"], 8)
  ];
  assert.equal(suggestNext(sessions, TODAY).pick?.name, "Arm day");
});

test("nothing fresh and due: rest or active recovery", () => {
  const all: TrainedSession["muscleGroups"] = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core"];
  assert.equal(suggestNext([session("2026-10-11", all, 5)], TODAY).pick, null);
});

test("at most one hard day per muscle a week: the next one is medium", () => {
  // Hard legs 5 days ago: fresh and due, but this week's second leg day is medium.
  const sessions = [session("2026-10-07", ["Legs"], 8), session("2026-10-11", ["Chest", "Back", "Shoulders", "Arms"], 5)];
  const pick = suggestNext(sessions, TODAY).pick!;
  assert.equal(pick.name, "Leg day");
  assert.ok(pick.work.filter((item) => item.muscle === "Quads").every((item) => item.intensity === "medium"));
});

test("shoulder rule: the day after hard rear delts, upper body is medium", () => {
  // Muscle-level logging counts: "rear delts hard" yesterday. Legs aren't due.
  const sessions = [session("2026-10-11", ["Rear Delts"], 5, { "Rear Delts": "hard" }), session("2026-10-10", ["Legs"], 5)];
  const pick = suggestNext(sessions, TODAY).pick!;
  assert.notEqual(pick.name, "Leg day");
  assert.ok(pick.work.every((item) => item.intensity !== "hard"));
  assert.equal(pick.heldBy?.id, "shoulder-joint");
});

test("at most 2 hard days in a row; the third is medium", () => {
  const sessions = [session("2026-10-10", ["Legs"], 8), session("2026-10-11", ["Calves"], 8)];
  const pick = suggestNext(sessions, TODAY).pick!;
  assert.ok(pick.work.every((item) => item.intensity !== "hard"));
  assert.equal(pick.heldBy?.id, "hard-streak");
});

test("an accessory comes from fresh, due muscles outside the day", () => {
  const sessions = [session("2026-10-09", ["Legs"], 8), session("2026-10-10", ["Back", "Arms"], 8)];
  const pick = suggestNext(sessions, TODAY).pick!;
  assert.equal(pick.name, "Push day");
  assert.ok(pick.accessory.length > 0);
  assert.ok(pick.accessory.every((muscle) => !["Chest", "Front Delts", "Side Delts", "Triceps"].includes(muscle)));
});

test("workout types roll up into strength, cardio, mobility and sport", () => {
  assert.equal(activityCategoryOf("strength"), "strength");
  assert.equal(activityCategoryOf("run"), "cardio");
  assert.equal(activityCategoryOf("yoga"), "mobility");
  assert.equal(activityCategoryOf("pilates"), "mobility");
  assert.equal(activityCategoryOf("sport"), "sport");
});

test("ignored watch workouts are never matched", () => {
  const workout = {
    id: "w1",
    day: TODAY,
    startedAt: `${TODAY}T07:00`,
    endedAt: `${TODAY}T07:01`,
    type: "WEIGHTS",
    name: "Weights",
    activeMinutes: 1,
    avgHr: 90,
    calories: 5,
    sessionId: null,
    mergedIds: [],
    ignored: false
  };
  const query = { date: TODAY, workoutType: "strength" as const, timeHint: null, loggedAt: `${TODAY}T09:00` };
  assert.equal(chooseMatch(query, [workout]).status, "matched");
  assert.equal(chooseMatch(query, [{ ...workout, ignored: true }]).status, "none");
});

test("muscles decide the kind of training when the type doesn't", () => {
  const kinds = activityCategoriesOf;
  assert.deepEqual(kinds("other", ["Mobility"]), ["mobility"]); // a stretching session
  assert.deepEqual(kinds("strength", ["Mobility"]), ["mobility"]); // core training that was really stretching
  assert.deepEqual(kinds("strength", ["Chest", "Mobility"]), ["strength", "mobility"]);
  assert.deepEqual(kinds("class", ["Cardio"]), ["cardio"]);
  assert.deepEqual(kinds("other", ["Lower Back"]), ["strength"]);
  assert.deepEqual(kinds("yoga", ["Mobility"]), ["mobility"]);
  assert.deepEqual(kinds("pilates", ["Core"]), ["mobility"]);
  assert.deepEqual(kinds("class", []), ["cardio"]); // no muscles: the type decides
});

test("old names count as today's: Mid Chest is Chest", () => {
  const sessions = [session("2026-10-11", ["Mid Chest"], 3)];
  assert.equal(loadOf(sessions, "Chest", TODAY).points, 1);
  assert.deepEqual(currentMuscles(["Upper Chest", "Mid Chest", "Lats"], { "Mid Chest": "hard" }), {
    muscleGroups: ["Chest", "Lats"],
    muscleIntensity: { Chest: "hard" }
  });
});

test("Traps are their own muscle, apart from Upper Back", () => {
  const sessions = [session("2026-10-11", ["Traps"], 8)];
  assert.equal(loadOf(sessions, "Traps", TODAY).points, 3);
  assert.equal(loadOf(sessions, "Upper Back", TODAY).points, 0);
  assert.equal(loadOf([session("2026-10-11", ["Back"], 8)], "Traps", TODAY).points, 3);
});

test("a group's day averages its muscles: one medium delt is a light shoulder day", () => {
  assert.equal(groupDayIntensity([session(TODAY, ["Side Delts"], 5)], "Shoulders"), "light");
  assert.equal(groupDayIntensity([session(TODAY, ["Side Delts", "Rear Delts"], 8)], "Shoulders"), "medium");
  assert.equal(groupDayIntensity([session(TODAY, ["Shoulders"], 5)], "Shoulders"), "medium");
  assert.equal(groupDayIntensity([session(TODAY, ["Shoulders"], 8)], "Shoulders"), "hard");
  assert.equal(groupDayIntensity([session(TODAY, ["Chest"], 8)], "Chest"), "hard");
  assert.equal(groupDayIntensity([session(TODAY, ["Chest"], 8)], "Shoulders"), undefined);
  // Two sessions the same day: each muscle takes its hardest.
  const day = [session(TODAY, ["Front Delts"], 8), session(TODAY, ["Front Delts", "Side Delts"], 5)];
  assert.equal(groupDayIntensity(day, "Shoulders"), "medium");
});

const sore = (date: string, muscle: string, level: number): SorenessReport => ({ id: `${date}-${muscle}`, date, muscle, level });

test("workouts set soreness and it fades: very sore is fresh in 4 days, sore in 2", () => {
  const hard = [session("2026-10-08", ["Quads"], 8)];
  assert.deepEqual([12, 11, 10, 9, 8].map((day) => loadOf(hard, "Quads", `2026-10-${String(day).padStart(2, "0")}`).readyIn), [0, 1, 2, 3, 4]);
  const medium = [session("2026-10-10", ["Quads"], 5)];
  assert.equal(loadOf(medium, "Quads", TODAY).readyIn, 0);
  assert.equal(loadOf(medium, "Quads", "2026-10-11").readyIn, 1);
});

test("the owner's soreness wins: sore holds a muscle back, fresh makes it ready", () => {
  const sessions = [session("2026-10-09", ["Quads"], 5)]; // medium, 3 days ago: fresh, 2 points
  assert.deepEqual(loadOf(sessions, "Quads", TODAY), { points: 2, soreness: 0, readyIn: 0 });
  assert.deepEqual(loadOf(sessions, "Quads", TODAY, [sore(TODAY, "Quads", 2)]), { points: 2, soreness: 2, readyIn: 3 });
  // Marked sore tonight: still out tomorrow.
  assert.equal(loadOf(sessions, "Quads", "2026-10-13", [sore(TODAY, "Quads", 2)]).soreness, 2);
  // His level holds through the next day, then fades.
  assert.equal(loadOf(sessions, "Quads", TODAY, [sore("2026-10-11", "Quads", 3)]).soreness, 3);
  assert.equal(loadOf(sessions, "Quads", TODAY, [sore("2026-10-10", "Quads", 3)]).soreness, 2.25);
  // Hard yesterday, but he says it feels fresh.
  const hard = [session("2026-10-11", ["Quads"], 8)];
  assert.equal(loadOf(hard, "Quads", TODAY).readyIn, 3);
  assert.equal(loadOf(hard, "Quads", TODAY, [sore(TODAY, "Quads", 0)]).readyIn, 0);
});

test("a muscle's week: due when ready and short, recovering when not, covered at 4", () => {
  const sessions = [session("2026-10-11", ["Lats"], 8), session("2026-10-08", ["Biceps"], 5), session("2026-10-10", ["Biceps"], 5)];
  assert.equal(muscleWeekOf(sessions, [], "Lats", TODAY).bucket, "recovering");
  assert.equal(muscleWeekOf(sessions, [], "Biceps", TODAY).bucket, "covered");
  assert.equal(muscleWeekOf(sessions, [], "Traps", TODAY).bucket, "due");
  assert.equal(muscleWeekOf(sessions, [sore(TODAY, "Traps", 1)], "Traps", TODAY).bucket, "recovering");
  const lats = muscleWeekOf(sessions, [], "Lats", TODAY);
  assert.deepEqual([lats.points, lats.readyIn, lats.hits.length], [3, 3, 1]);
});

test("sore muscles are out: light blood-flow only, even long after the workout", () => {
  // Legs trained 6 days ago but he says they're still sore.
  const sessions = [session("2026-10-06", ["Legs"], 8), session("2026-10-11", ["Chest", "Back", "Shoulders", "Arms"], 5)];
  const reports = ["Quads", "Hamstrings", "Glutes"].map((muscle) => sore(TODAY, muscle, 2));
  const next = suggestNext(sessions, TODAY, reports);
  assert.deepEqual(next.out.map((item) => item.muscle).sort(), ["Glutes", "Hamstrings", "Quads"]);
  assert.ok(!next.pick?.work.some((item) => item.muscle === "Quads"));
});

test("slightly sore muscles go up to medium", () => {
  const reports = ["Lats", "Upper Back", "Traps", "Rear Delts", "Biceps", "Forearms"].map((muscle) => sore(TODAY, muscle, 1));
  const sessions = [session("2026-10-10", ["Chest", "Shoulders", "Triceps", "Legs"], 8)];
  const pick = suggestNext(sessions, TODAY, reports).pick!;
  assert.equal(pick.name, "Pull day");
  assert.ok(pick.work.filter((item) => item.muscle === "Lats").every((item) => item.intensity === "medium"));
});

test("the split counts a workout for every kind it includes, against 4/2/2", () => {
  const split = splitOf([
    activityCategoriesOf("strength", ["Chest", "Mobility"]), // strength + mobility
    activityCategoriesOf("strength", ["Legs"]),
    activityCategoriesOf("run", ["Cardio"]),
    activityCategoriesOf("sport")
  ]);
  assert.deepEqual(
    split.map((entry) => [entry.kind, entry.count, entry.target]),
    [
      ["strength", 2, 4],
      ["cardio", 1, 2],
      ["mobility", 1, 2],
      ["sport", 1, null]
    ]
  );
});
