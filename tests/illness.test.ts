import assert from "node:assert/strict";
import { test } from "node:test";
import { illnessSignal } from "@/lib/health/illness";
import type { HealthDay } from "@/lib/health/queries";
import { easingOn, episodesOf, sickOn, type IllnessDay } from "@/lib/illness-days";
import { suggestNext, type TrainedSession } from "@/lib/workouts";

const TODAY = "2026-10-30";

function shift(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// A synthetic ordinary month: resting HR 64-66, HRV 75, breathing 14, temp 0.
function month(overrides: Record<string, Partial<HealthDay>> = {}): HealthDay[] {
  return Array.from({ length: 35 }, (_, index) => {
    const day = shift(TODAY, index - 34);
    return {
      day,
      steps: null,
      distanceMiles: null,
      activeKcal: null,
      totalKcal: null,
      zoneMinutesFatBurn: null,
      zoneMinutesCardio: null,
      zoneMinutesPeak: null,
      restingHr: 64 + (index % 3),
      hrvMs: 75,
      sleepMinutes: 480,
      deepMinutes: null,
      remMinutes: null,
      lightMinutes: null,
      awakeMinutes: null,
      spo2Pct: null,
      breathsPerMin: 14,
      vo2Max: null,
      sleepTempVsBaselineC: 0,
      bedtime: null,
      wakeTime: null,
      ...overrides[day]
    };
  });
}

test("an ordinary day has no signal", () => {
  assert.equal(illnessSignal(month(), TODAY).level, "none");
});

test("resting HR up 3 is possible; a second day with a warm night is likely", () => {
  const yesterday = shift(TODAY, -1);
  const one = illnessSignal(month({ [TODAY]: { restingHr: 68 } }), TODAY);
  assert.equal(one.level, "possible");
  assert.deepEqual(one.reasons, ["Resting HR 68, usually 65"]);
  const two = illnessSignal(month({ [yesterday]: { restingHr: 69 }, [TODAY]: { restingHr: 69, sleepTempVsBaselineC: 0.5 } }), TODAY);
  assert.equal(two.level, "likely");
  // One strong day is enough: +5 and a warm night.
  assert.equal(illnessSignal(month({ [TODAY]: { restingHr: 70, sleepTempVsBaselineC: 0.5 } }), TODAY).level, "likely");
});

test("low HRV or a warm night alone isn't flagged; a fever-like night is", () => {
  assert.equal(illnessSignal(month({ [TODAY]: { hrvMs: 40, sleepTempVsBaselineC: 0.5 } }), TODAY).level, "none");
  assert.equal(illnessSignal(month({ [TODAY]: { sleepTempVsBaselineC: 1.2 } }), TODAY).level, "possible");
});

test("logged sick days stay out of the baseline", () => {
  // A week of being sick at 72 three weeks ago would lift the baseline.
  const sickWeek = Array.from({ length: 7 }, (_, index) => shift(TODAY, -20 + index));
  const days = month(Object.fromEntries(sickWeek.map((day) => [day, { restingHr: 75 }])));
  const today = { ...days.at(-1)!, restingHr: 68 };
  days[days.length - 1] = today;
  assert.equal(illnessSignal(days, TODAY).level, "none");
  assert.equal(illnessSignal(days, TODAY, new Set(sickWeek)).level, "possible");
});

test("no signal without enough history", () => {
  assert.equal(illnessSignal(month().slice(-10), TODAY).level, "none");
});

const day = (date: string, severity: number): IllnessDay => ({ id: date, date, severity, symptoms: [], note: null });

test("episodes: a day's gap joins, Better ends one, and a missed log carries 2 days", () => {
  const days = [day("2026-10-01", 1), day("2026-10-03", 2), day("2026-10-05", 0), day("2026-10-20", 1)];
  const episodes = episodesOf(days);
  assert.deepEqual(episodes.map((item) => [item.start, item.last, item.peak, item.ended]), [
    ["2026-10-01", "2026-10-03", 2, "2026-10-05"],
    ["2026-10-20", "2026-10-20", 1, null]
  ]);
  assert.equal(sickOn(days, "2026-10-04")?.severity, 2);
  assert.equal(sickOn(days, "2026-10-04")?.dayNumber, 4);
  assert.equal(sickOn(days, "2026-10-05"), null);
  assert.equal(sickOn(days, "2026-10-22")?.loggedToday, false);
  assert.equal(sickOn(days, "2026-10-23"), null);
});

test("easing back for 2 days after an illness that reached Sick", () => {
  const days = [day("2026-10-27", 2), day("2026-10-28", 2), day("2026-10-29", 0)];
  assert.ok(easingOn(days, "2026-10-29"));
  assert.ok(easingOn(days, "2026-10-30"));
  assert.equal(easingOn(days, "2026-10-31"), null);
  // A mild cold needs no easing back.
  assert.equal(easingOn([day("2026-10-28", 1), day("2026-10-29", 0)], "2026-10-30"), null);
});

const session = (date: string, names: TrainedSession["muscleGroups"], rpe: number): TrainedSession => ({ date, muscleGroups: names, muscleIntensity: {}, rpe });

test("Next up: rest when sick, light when mild, nothing hard while easing or flagged", () => {
  const sessions = [session("2026-10-20", ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core"], 8)];
  const normal = suggestNext(sessions, TODAY);
  assert.ok(normal.pick && normal.pick.work.some((item) => item.intensity === "hard"));
  assert.equal(normal.illness, null);

  const sick = suggestNext(sessions, TODAY, [], undefined, { kind: "sick", severity: 2, label: "Sick" });
  assert.equal(sick.pick, null);
  assert.equal(sick.illness?.rest, true);
  assert.deepEqual(sick.alternatives, []);

  const mild = suggestNext(sessions, TODAY, [], undefined, { kind: "sick", severity: 1, label: "Mild" });
  assert.ok(mild.pick?.work.every((item) => item.intensity === "light"));

  for (const kind of ["easing", "watch"] as const) {
    const next = suggestNext(sessions, TODAY, [], undefined, { kind });
    assert.ok(next.pick?.work.every((item) => item.intensity !== "hard"));
    assert.ok(next.illness?.note);
  }
});
