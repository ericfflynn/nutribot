import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBodyState, readinessOf, worstOf } from "@/lib/body-state/build";
import { checkCall, guardrailsOf, rulesCall } from "@/lib/body-state/call";
import type { Ailment } from "@/lib/ailments-core";
import { sleepConsistency, sleepDebt, sleepNeed } from "@/lib/health/scores";
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
    ailments: [],
    journal: [],
    habits: [],
    habitLogs: [],
    meals: [],
    water: {},
    goals: { calories: 2200, proteinPct: 30, carbsPct: 40, fatPct: 30, waterOz: 100, caffeineLimitMg: 400, caffeineCutoff: "14:00", addedSugarLimitG: 36 },
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
    scaleGuide: null, goal: 2, bands: null, cutoff: null, cutoffWeeknights: false, days: null, active: true
  };
  const log: HabitLog = { id: "l1", habitId: "h1", amount: 3, details: null, startedAt: "20:00", endedAt: "23:30", date: shift(TODAY, -1), createdAt: "" };
  const withDrinks = buildBodyState(sources({ health: health(raised), habits: [drinks], habitLogs: [log] }), TODAY);
  assert.equal(withDrinks.physical.illness.phase, "well");
  assert.match(withDrinks.physical.illness.headline, /likely 3 drinks/);
  assert.equal(withDrinks.explanations[0].kind, "habit");

  const stressed = buildBodyState(sources({ health: health(raised), journal: [entry(shift(TODAY, -1), ["work:deadline", "stressor:work"], { stress: 4 })] }), TODAY);
  assert.equal(stressed.physical.illness.phase, "early_signs");
  assert.equal(stressed.lifestyle.career.status, "watch");
});

const ailment = (overrides: Partial<Ailment> & Pick<Ailment, "days">): Ailment => ({
  id: "a1",
  kind: "illness",
  name: "Head cold",
  bodyParts: [],
  muscles: [],
  startedOn: overrides.days[0].date,
  endedOn: null,
  cause: null,
  causeRefs: [],
  note: null,
  ...overrides
});
const day = (date: string, severity: number, symptoms: string[] = []) => ({ id: date, date, severity, symptoms, note: null, journalEntryId: null });

test("an open illness is sick until it's over, however long since the last report, then eases back", () => {
  const cold = ailment({ days: [day(shift(TODAY, -6), 2, ["congestion"])] });
  const state = buildBodyState(sources({ ailments: [cold], sessions: [session(shift(TODAY, -6), ["Legs"], 8)] }), TODAY);
  assert.equal(state.physical.illness.phase, "sick");
  assert.equal(state.physical.illness.told?.source, "ailment");
  assert.equal(state.physical.illness.told?.day, 7);
  assert.equal(state.physical.ailments?.status, "low");
  assert.equal(state.physical.training.suggested.name, null);
  assert.equal(rulesCall(state, `${TODAY}T07:00`).ask, "How's the head cold today?");

  const over = { ...cold, days: [...cold.days, day(shift(TODAY, -1), 0)], endedOn: shift(TODAY, -1) };
  const easing = buildBodyState(sources({ ailments: [over] }), TODAY);
  assert.equal(easing.physical.illness.phase, "recovering");
  assert.equal(easing.physical.ailments?.open[0].phase, "easing");
  assert.equal(buildBodyState(sources({ ailments: [over] }), shift(TODAY, 1)).physical.illness.phase, "well");
});

test("a sore shoulder: the rules skip it, Claude weighs it, and a bad one rests the whole upper body", () => {
  const shoulder = (severity: number) =>
    ailment({
      kind: "pain",
      name: "Right shoulder",
      bodyParts: ["right shoulder"],
      muscles: ["Chest", "Front Delts", "Side Delts", "Rear Delts", "Triceps", "Lats", "Upper Back", "Traps"],
      days: [day(shift(TODAY, -1), severity)]
    });
  const sessions = [session(shift(TODAY, -8), ["Chest", "Back", "Shoulders", "Arms", "Legs"], 7)];
  const hurts = buildBodyState(sources({ ailments: [shoulder(2)], sessions }), TODAY);
  assert.equal(hurts.physical.illness.phase, "well");
  assert.equal(hurts.physical.ailments?.status, "watch");
  assert.match(hurts.physical.ailments!.headline, /Right shoulder · day 2, hurts/);
  assert.equal(hurts.physical.training.suggested.name, "Leg day");
  const out = new Map(hurts.physical.training.muscles.map((item) => [item.muscle, item.out]));
  assert.equal(out.get("Rear Delts"), "right shoulder");
  assert.equal(out.get("Biceps"), null);
  // Not a hard limit below bad: Claude may work it, but has to say why.
  const guard = guardrailsOf(hurts, { sessions });
  const cap = new Map(guard.muscles.map((item) => [item.muscle, item.max]));
  assert.equal(cap.get("Chest"), "hard");
  assert.deepEqual(guard.ailments?.map((item) => item.name), ["Right shoulder"]);
  const week = (guard.weekLeft ?? []).map((day) => ({ day, plan: "Rest" }));
  const push = { kind: "strength" as const, work: [{ muscle: "Chest" as const, intensity: "medium" as const }], accessory: [], week };
  assert.match(checkCall(push, guard) ?? "", /how today's plan treats the right shoulder/);
  assert.equal(checkCall({ ...push, ailments: [{ name: "Right shoulder", plan: "Felt fine on pushups yesterday, medium chest only" }] }, guard), null);
  assert.deepEqual(rulesCall(hurts, `${TODAY}T07:00`).ailments, [{ name: "Right shoulder", plan: "Skipping shoulders, chest, triceps, lats, upper back, traps work." }]);
  assert.equal(rulesCall(hurts, `${TODAY}T07:00`).ask, "How's the right shoulder today?");

  const bad = buildBodyState(sources({ ailments: [shoulder(3)], sessions }), TODAY);
  const badGuard = guardrailsOf(bad, { sessions });
  assert.equal(bad.physical.ailments?.status, "low");
  assert.equal(badGuard.muscles.find((item) => item.muscle === "Biceps")?.max, null);
  assert.equal(badGuard.muscles.find((item) => item.muscle === "Forearms")?.max, null);
  assert.equal(badGuard.muscles.find((item) => item.muscle === "Quads")?.max, "medium");
  assert.equal(badGuard.maxIntensity, "medium");
  assert.match(bad.physical.ailments!.headline, /Upper body out, nothing hard/);
});

test("an illness and an injury can be open together", () => {
  const cold = ailment({ id: "c", days: [day(shift(TODAY, -1), 1)] });
  const wrist = ailment({ id: "w", kind: "injury", name: "Wrist", bodyParts: ["wrist"], muscles: ["Forearms"], days: [day(shift(TODAY, -3), 2)] });
  const state = buildBodyState(sources({ ailments: [cold, wrist] }), TODAY);
  assert.equal(state.physical.ailments?.open.length, 2);
  assert.equal(state.physical.illness.phase, "sick");
  assert.equal(rulesCall(state, `${TODAY}T07:00`).ask, "How's the wrist and the head cold today?");
});

test("work and people read the tags' keys and how they felt", () => {
  const journal = [
    entry(shift(TODAY, -1), ["work-", "with:partner-"], { mood: 3 }),
    entry(shift(TODAY, -3), ["work:deadline-"], { mood: 4 }),
    entry(shift(TODAY, -5), ["work-", "did:watched sports+"], { mood: 4 })
  ];
  const state = buildBodyState(sources({ journal }), TODAY);
  assert.equal(state.lifestyle.career.status, "watch");
  assert.equal(state.lifestyle.career.headline, "Work felt bad 3 of the last 7 days");
  assert.equal(state.lifestyle.relationships.status, "watch");
  assert.match(state.lifestyle.relationships.headline, /Time with partner felt bad/);
  const stressed = buildBodyState(sources({ journal: [entry(TODAY, ["stressor:money"], { mood: 2, stress: 4 })] }), TODAY);
  assert.match(stressed.mental.mood.headline, /stress 4 from money/);
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

test("days since hit counts today's session and light work", () => {
  const today = { ...session(TODAY, ["Lats", "Chest"], 6), id: "today", muscleIntensity: { Lats: "medium", Chest: "light" } } as WorkoutSession;
  const sessions = [today, session(shift(TODAY, -4), ["Back"], 6)];
  const state = buildBodyState(sources({ sessions }), TODAY);
  const since = (muscle: string) => state.physical.training.muscles.find((item) => item.muscle === muscle)?.daysSinceHit;
  assert.equal(since("Lats"), 0);
  assert.equal(since("Chest"), 0);
  const lats = state.physical.training.muscles.find((item) => item.muscle === "Lats");
  assert.deepEqual(lats?.recentHits, [0, 4]);
  // The day type only counts medium or hard: light chest isn't a push day.
  assert.notEqual(state.physical.training.groups.push, 0);
});

test("readiness: Nov 3 (red, drinks, three hard days, big food day) is a rest day", () => {
  const recovery = { band: "red", score: 20 } as Parameters<typeof readinessOf>[0];
  const load = { hardStreak: 3 } as Parameters<typeof readinessOf>[1];
  const drinks = [{ kind: "habit", detail: "4 drinks last night", affects: ["recovery"], source: "lifestyle.habits" }] as Parameters<typeof readinessOf>[2];
  const day = { calories: 3839, caloriesTarget: 3137, proteinG: 169, proteinTarget: 196, waterOz: null, waterTarget: 100 };
  const fuel = { yesterday: day } as Parameters<typeof readinessOf>[3];
  const tired = readinessOf(recovery, load, drinks, fuel);
  assert.equal(tired.level, "rest");
  assert.deepEqual(tired.reasons, ["recovery red (20)", "4 drinks last night", "3 hard days in a row", "a rough food day yesterday"]);
  // Red alone is an easy day; green with a normal day is normal.
  assert.equal(readinessOf(recovery, { hardStreak: 0 } as typeof load, [], { yesterday: null } as typeof fuel).level, "easy");
  assert.equal(readinessOf({ band: "green", score: 80 } as typeof recovery, { hardStreak: 0 } as typeof load, [], { yesterday: null } as typeof fuel).level, "normal");
});

test("a strenuous watch day counts as a hard day", () => {
  const strenuous = { [shift(TODAY, -1)]: { zoneMinutesCardio: 90, zoneMinutesPeak: 30, steps: 20000 }, [shift(TODAY, -2)]: { zoneMinutesCardio: 90, zoneMinutesPeak: 30, steps: 20000 } };
  const state = buildBodyState(sources({ health: health(strenuous) }), TODAY);
  assert.equal(state.physical.load.hardStreak, 2);
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

test("sleep consistency is a 7-night regularity index: identical nights 100, needs 5 nights", () => {
  const regular = buildBodyState(sources(), TODAY).physical.sleep;
  assert.equal(regular.consistency7n, 100);
  assert.equal(regular.score, 100);
  assert.equal(regular.usualBedtime, "23:00");
  assert.equal(regular.usualWakeTime, "07:00");
  assert.equal(regular.nights7.at(-1)?.bedtime, "23:00");
  const night = (bed: string, wake: string) => ({ bedtime: `2026-11-01T${bed}:00`, wakeTime: `2026-11-02T${wake}:00` });
  // Alternating 11 pm and 1 am, 8 hours each: 2 of 24 hours differ on each
  // side, so 20 of 24 match: 200 × 20/24 − 100 = 67.
  const alternating = Array.from({ length: 7 }, (_, index) => (index % 2 ? night("01:00", "09:00") : night("23:00", "07:00")));
  assert.equal(sleepConsistency(alternating), 67);
  assert.equal(sleepConsistency([night("23:00", "07:00"), null, night("23:00", "07:00"), null, night("23:00", "07:00")]), null);
});

test("sleep need: 8 h, plus hard-day strain, a quarter of the debt and sick days, capped", () => {
  assert.equal(sleepNeed({ strainYesterday: 9, debtMinutes: 0, sick: false }).minutes, 480);
  assert.equal(sleepNeed({ strainYesterday: 16, debtMinutes: 0, sick: false }).strain, 18);
  assert.equal(sleepNeed({ strainYesterday: 21, debtMinutes: 0, sick: false }).strain, 30);
  assert.equal(sleepNeed({ strainYesterday: null, debtMinutes: 120, sick: false }).debt, 30);
  assert.equal(sleepNeed({ strainYesterday: 21, debtMinutes: 600, sick: true }).minutes, 570);
  // Debt is against 8 h: a long night pays a short one back.
  assert.equal(sleepDebt([420, 540]), 0);
  assert.equal(sleepDebt([540, 420, 420]), 120);
});

test("a short night after a hard day scores lower; an irregular week keeps sleep from good", () => {
  const hardDay = { [shift(TODAY, -1)]: { zoneMinutesCardio: 60, zoneMinutesPeak: 20 }, [TODAY]: { sleepMinutes: 450 } };
  const easy = buildBodyState(sources({ health: health({ [TODAY]: { sleepMinutes: 450 } }) }), TODAY).physical.sleep;
  const hard = buildBodyState(sources({ health: health(hardDay) }), TODAY).physical.sleep;
  assert.ok(hard.needMinutes > easy.needMinutes);
  assert.ok(hard.score! < easy.score!);
  const late = (days: number) => ({ [shift(TODAY, days)]: { bedtime: `${shift(TODAY, days - 1)}T01:30:00`, wakeTime: `${shift(TODAY, days)}T09:30:00` } });
  const state = buildBodyState(sources({ health: health({ ...late(-5), ...late(-3), ...late(-1) }) }), TODAY);
  assert.ok(state.physical.sleep.consistency7n! < 80);
  assert.equal(state.physical.sleep.status, "ok");
  assert.match(state.physical.sleep.headline, /irregular/);
});
