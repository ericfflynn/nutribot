import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBodyState, journalSickDays, worstOf } from "@/lib/body-state/build";
import type { BodySources } from "@/lib/body-state/types";
import type { HealthDay } from "@/lib/health/queries";
import type { Habit, HabitLog } from "@/lib/habits";
import type { JournalEntry } from "@/lib/journal";
import type { WorkoutSession } from "@/lib/workouts";

const TODAY = "2026-11-12";

function shift(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// 63 ordinary days: resting HR 56-58, HRV 70, 8 h of sleep from 11 pm.
function health(overrides: Record<string, Partial<HealthDay>> = {}): HealthDay[] {
  return Array.from({ length: 63 }, (_, index) => {
    const day = shift(TODAY, index - 62);
    return {
      day,
      steps: 8000,
      distanceMiles: null,
      activeKcal: 500,
      totalKcal: 2500,
      zoneMinutesFatBurn: 20,
      zoneMinutesCardio: 5,
      zoneMinutesPeak: 0,
      restingHr: 56 + (index % 3),
      hrvMs: 70,
      sleepMinutes: 480,
      deepMinutes: 80,
      remMinutes: 100,
      lightMinutes: 300,
      awakeMinutes: 30,
      spo2Pct: 96,
      breathsPerMin: 14,
      vo2Max: null,
      sleepTempVsBaselineC: 0,
      bedtime: `${shift(day, -1)}T23:00:00`,
      wakeTime: `${day}T07:00:00`,
      ...overrides[day]
    };
  });
}

function sources(overrides: Partial<BodySources> = {}): BodySources {
  return {
    health: health(),
    healthWorkouts: [],
    sessions: [],
    fitbit: [],
    soreness: [],
    illness: [],
    journal: [],
    habits: [],
    habitLogs: [],
    meals: [],
    water: {},
    goals: { calories: 2200, proteinPct: 30, carbsPct: 40, fatPct: 30, waterOz: 100 },
    lastSync: null,
    ...overrides
  };
}

const entry = (date: string, tags: string[], ratings: Partial<JournalEntry["ratings"]> = {}): JournalEntry => ({
  id: `${date}-${tags.join("-")}`,
  date,
  kind: "evening",
  body: "",
  ratings: { mood: null, stress: null, energy: null, soreness: null, ...ratings },
  tags,
  createdAt: `${date}T21:00:00`
});

const session = (date: string, muscleGroups: WorkoutSession["muscleGroups"], rpe: number): WorkoutSession =>
  ({ id: date, date, name: "Lift", workoutType: "strength", muscleGroups, muscleIntensity: {}, rpe, durationMin: 60, matchStatus: "untracked", healthRecordKey: null, notes: null }) as WorkoutSession;

test("a domain takes its worst known area; unknown areas are skipped", () => {
  assert.deepEqual(worstOf([{ status: "good", headline: "a" }, { status: "watch", headline: "b" }, { status: "unknown", headline: "c" }]), {
    status: "watch",
    headline: "b"
  });
  assert.equal(worstOf([{ status: "unknown", headline: "x" }]).status, "unknown");
});

test("an ordinary day: good vitals, sleep and illness; no data is unknown, not zero", () => {
  const state = buildBodyState(sources(), TODAY);
  assert.equal(state.physical.vitals.status, "good");
  assert.equal(state.physical.sleep.status, "good");
  assert.equal(state.physical.illness.phase, "well");
  assert.equal(state.physical.fuel.status, "unknown");
  assert.equal(state.mental.status, "unknown");
  assert.ok(state.meta.missing.includes("meals"));
  assert.equal(state.physical.vitals.restingHr.usual, 57);
});

test("raised resting HR and a warm night are early signs, and lead the physical domain", () => {
  const raised = { [shift(TODAY, -1)]: { restingHr: 61 }, [TODAY]: { restingHr: 62, sleepTempVsBaselineC: 0.5 } };
  const state = buildBodyState(sources({ health: health(raised) }), TODAY);
  assert.equal(state.physical.illness.phase, "early_signs");
  assert.equal(state.physical.illness.phaseSince, shift(TODAY, -1));
  assert.equal(state.physical.vitals.restingHr.streak, 2);
  assert.equal(state.physical.status, "low");
  assert.match(state.physical.training.suggested.note ?? "", /may be getting sick/);
});

test("drinks last night explain a raised resting HR; work stress doesn't", () => {
  const raised = { [TODAY]: { restingHr: 61 } };
  const drinks: Habit = {
    id: "h1", name: "Drinks", description: null, measure: "count", unit: "drinks", direction: "limit",
    scaleGuide: null, goal: 2, cutoff: null, cutoffWeeknights: false, days: null, active: true
  };
  const log: HabitLog = { id: "l1", habitId: "h1", amount: 3, details: null, startedAt: "20:00", endedAt: "23:30", date: shift(TODAY, -1), createdAt: "" };
  const withDrinks = buildBodyState(sources({ health: health(raised), habits: [drinks], habitLogs: [log] }), TODAY);
  assert.equal(withDrinks.physical.illness.phase, "well");
  assert.match(withDrinks.physical.illness.headline, /likely 3 drinks/);
  assert.equal(withDrinks.explanations[0].kind, "habit");

  const stressed = buildBodyState(sources({ health: health(raised), journal: [entry(shift(TODAY, -1), ["work", "deadline"], { stress: 4 })] }), TODAY);
  assert.equal(stressed.physical.illness.phase, "early_signs");
  assert.equal(stressed.lifestyle.career.status, "watch");
});

test("a journal entry tagged sick is a sick day that carries, and rests training", () => {
  const journal = [entry(shift(TODAY, -2), ["sick", "headache"])];
  assert.deepEqual(journalSickDays(journal, []).map((day) => [day.severity, day.symptoms]), [[2, ["headache"]]]);
  const state = buildBodyState(sources({ journal, sessions: [session(shift(TODAY, -6), ["Legs"], 8)] }), TODAY);
  assert.equal(state.physical.illness.phase, "sick");
  assert.equal(state.physical.illness.told?.source, "journal");
  assert.equal(state.physical.illness.told?.day, 3);
  assert.equal(state.physical.training.suggested.name, null);
  // A logged day for the same date wins over the journal.
  assert.deepEqual(journalSickDays(journal, [{ id: "x", date: shift(TODAY, -2), severity: 1, symptoms: [], note: null }]), []);
});

test("training watches whole day types, not single muscles", () => {
  const sessions = [
    session(shift(TODAY, -2), ["Chest", "Shoulders", "Triceps", "Core"], 8),
    session(shift(TODAY, -3), ["Back", "Biceps", "Forearms"], 8),
    session(shift(TODAY, -9), ["Legs"], 8)
  ];
  const state = buildBodyState(sources({ sessions }), TODAY);
  assert.equal(state.physical.training.groups.legs, 9);
  assert.equal(state.physical.training.status, "watch");
  assert.match(state.physical.training.headline, /^Legs: 9 days/);
});

test("mood: low streaks and high stress", () => {
  const journal = [entry(shift(TODAY, -2), [], { mood: 2 }), entry(shift(TODAY, -1), [], { mood: 2 }), entry(TODAY, [], { mood: 2, stress: 4 })];
  const state = buildBodyState(sources({ journal }), TODAY);
  assert.equal(state.mental.mood.lowStreak, 3);
  assert.equal(state.mental.status, "low");
  assert.deepEqual(state.mental.mood.stress, { value: 4, date: TODAY });
});

test("the stored hash ignores meta, so a rebuild that changes nothing isn't saved", async () => {
  const { stateHash, upgradeState } = await import("@/lib/body-state/store");
  const a = buildBodyState(sources(), TODAY, { builtAt: "2026-11-12T08:00:00Z", trigger: "morning" });
  const b = buildBodyState(sources(), TODAY, { builtAt: "2026-11-12T14:00:00Z", trigger: "late_data" });
  assert.equal(stateHash(a), stateHash(b));
  const later = buildBodyState(sources({ journal: [entry(TODAY, [], { mood: 4 })] }), TODAY);
  assert.notEqual(stateHash(a), stateHash(later));
  // The current schema reads as is; an unknown older one says so.
  assert.equal(upgradeState(a as unknown as Record<string, unknown>, 1).meta.date, TODAY);
  assert.throws(() => upgradeState({}, 0), /No upgrade from body state v0/);
});
