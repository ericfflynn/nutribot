// buildBodyState: every source for a day into one body state. Pure, so it's
// unit-tested and gives the same answer for the same data. Each area's status
// rule is in docs/body-state.md; change both together.
import { addDays, weekdayOf } from "../dates";
import { gramsFromPercentGoals, restingKcalPerMinute, withWorkoutCalories, workoutCalories } from "../goals";
import { baselineDays, illnessSignal } from "../health/illness";
import type { HealthDay, HealthWorkout } from "../health/queries";
import { SLEEP_NEED_MINUTES, dayStrain, recoveryScore, sleepPerformance } from "../health/scores";
import { formatClockTime, formatHabitAmount, habitOutcome, summarizeHabitDay, trackedOn, type Habit } from "../habits";
import { SEVERITY_LABELS, SYMPTOMS, easingOn, sickOn, type IllnessDay, type Symptom } from "../illness-days";
import { ENERGY_LABELS, MOOD_LABELS, type JournalEntry } from "../journal";
import { TAG_CATEGORIES } from "../journal-tags";
import { summarizeEntries } from "../supabase";
import { caffeineDay, sugarDay } from "../nutrients";
import {
  DAY_TYPES,
  DUE_AFTER_DAYS,
  SORENESS_LEVELS,
  TRACKED_MUSCLES,
  intensityOf,
  lastHitOf,
  muscleWeekOf,
  sorenessStep,
  splitKinds,
  splitOf,
  suggestNext,
  trackedOf,
  type IllnessState,
  type TrackedMuscle
} from "../workouts";
import {
  SCHEMA_VERSION,
  type BodySources,
  type BodyState,
  type CareerArea,
  type Explanation,
  type FuelArea,
  type FuelDay,
  type HabitsArea,
  type Head,
  type IllnessArea,
  type LoadArea,
  type MoodArea,
  type MuscleState,
  type RecoveryArea,
  type RelationshipsArea,
  type SleepArea,
  type Status,
  type TrainingArea,
  type Vital,
  type VitalsArea
} from "./types";
import { fahrenheitDelta } from "../health/units";

const WORST: Status[] = ["low", "watch", "ok", "good"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A domain's head: its worst known area, with that area's headline.
export function worstOf(heads: readonly Head[]): Head {
  const known = heads.filter((head) => head.status !== "unknown");
  if (!known.length) return { status: "unknown", headline: "No data yet" };
  return known.reduce((worst, head) => (WORST.indexOf(head.status) < WORST.indexOf(worst.status) ? head : worst));
}

function hm(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h${m ? ` ${m} m` : ""}` : `${m} m`;
}

const round = (value: number, places = 0) => Math.round(value * 10 ** places) / 10 ** places;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const spread = (values: number[]) => {
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
};
const dayName = (date: string) => WEEKDAY[weekdayOf(date)];
const lastDays = (date: string, count: number) => Array.from({ length: count }, (_, index) => addDays(date, index - count + 1));

// Clock time as minutes after 6 pm, so a bedtime after midnight sorts after one before.
function eveningMinutes(timestamp: string) {
  const [h, m] = timestamp.slice(11, 16).split(":").map(Number);
  return (h * 60 + m - 18 * 60 + 1440) % 1440;
}

// A journal entry tagged "sick" counts as a sick day (severity Sick, its
// symptom tags as symptoms) until the journal records illness itself
// (docs/body-state.md, Reports). A logged sick day for the date wins.
export function journalSickDays(entries: readonly JournalEntry[], logged: readonly IllnessDay[]): IllnessDay[] {
  const loggedDates = new Set(logged.map((day) => day.date));
  const byDate = new Map<string, IllnessDay>();
  for (const entry of entries) {
    if (!entry.tags.includes("sick") || loggedDates.has(entry.date)) continue;
    const symptoms = entry.tags.filter((tag): tag is Symptom => (SYMPTOMS as readonly string[]).includes(tag));
    const before = byDate.get(entry.date);
    byDate.set(entry.date, {
      id: `journal-${entry.id}`,
      date: entry.date,
      severity: 2,
      symptoms: [...new Set([...(before?.symptoms ?? []), ...symptoms])],
      note: null
    });
  }
  return [...byDate.values()];
}

type Context = {
  date: string;
  yesterday: string;
  sources: BodySources;
  healthByDay: Map<string, HealthDay>;
  workoutsByDay: Map<string, HealthWorkout[]>;
  sickDates: Set<string>;
  illnessDays: IllnessDay[]; // logged plus journal-tagged
  journalSick: Set<string>; // dates whose sick day came from the journal
};

// The physical domain's head: when something's wrong, illness speaks first;
// on an ok or good day, recovery does ("89, green" over "No signs of illness").
function physicalHead(problemOrder: Head[], fineOrder: Head[]): Head {
  const worst = worstOf(problemOrder);
  if (worst.status === "low" || worst.status === "watch" || worst.status === "unknown") return worst;
  return { status: worst.status, headline: fineOrder.find((head) => head.status === worst.status)!.headline };
}

// ---------- Physical ----------

function sleepArea(c: Context): SleepArea {
  const night = c.healthByDay.get(c.date);
  const minutes = night?.sleepMinutes ?? null;
  const nights = [c.date, addDays(c.date, -1), addDays(c.date, -2)].map((day) => c.healthByDay.get(day)?.sleepMinutes ?? null);
  const known = nights.filter((value): value is number => value != null);
  const debt3n = known.length ? known.reduce((sum, value) => sum + Math.max(0, SLEEP_NEED_MINUTES - value), 0) : null;
  const before = lastDays(addDays(c.date, -1), 7)
    .map((day) => c.healthByDay.get(day)?.bedtime)
    .filter((value): value is string => Boolean(value))
    .map(eveningMinutes);
  const bedtimeDrift7n = night?.bedtime && before.length >= 3 ? Math.round(eveningMinutes(night.bedtime) - median(before)) : null;
  const pct = sleepPerformance(minutes);
  const base = {
    minutes,
    needMinutes: SLEEP_NEED_MINUTES,
    pct,
    bedtime: night?.bedtime?.slice(11, 16) ?? null,
    wakeTime: night?.wakeTime?.slice(11, 16) ?? null,
    deepMinutes: night?.deepMinutes ?? null,
    remMinutes: night?.remMinutes ?? null,
    lightMinutes: night?.lightMinutes ?? null,
    awakeMinutes: night?.awakeMinutes ?? null,
    nights7: lastDays(c.date, 7).map((date) => {
      const day = c.healthByDay.get(date);
      return {
        date,
        minutes: day?.sleepMinutes ?? null,
        deep: day?.deepMinutes ?? null,
        light: day?.lightMinutes ?? null,
        rem: day?.remMinutes ?? null,
        awake: day?.awakeMinutes ?? null
      };
    }),
    debt3n,
    bedtimeDrift7n
  };
  if (minutes == null || pct == null) return { ...base, status: "unknown", headline: "Last night's sleep hasn't synced" };
  const status: Status =
    pct < 60 ? "low" : pct < 75 || (debt3n ?? 0) >= 120 ? "watch" : pct >= 90 && (debt3n ?? 0) < 60 ? "good" : "ok";
  const parts = [`${hm(minutes)}, ${pct}% of need`];
  if ((debt3n ?? 0) >= 60) parts.push(`${hm(debt3n!)} short over 3 nights`);
  if ((bedtimeDrift7n ?? 0) >= 60) parts.push(`to bed ${hm(bedtimeDrift7n!)} later than usual`);
  return { ...base, status, headline: parts.join(", ") };
}

function recoveryArea(c: Context): RecoveryArea {
  const days = [...c.sources.health].sort((a, b) => a.day.localeCompare(b.day));
  const scoreOn = (date: string) => {
    const index = days.findIndex((day) => day.day === date);
    if (index < 0 || days[index].hrvMs == null || days[index].restingHr == null) return null;
    return recoveryScore(days.slice(0, index + 1));
  };
  const today = scoreOn(c.date);
  const trend7 = lastDays(c.date, 7).map((day) => scoreOn(day)?.score ?? null);
  const prior = lastDays(addDays(c.date, -1), 7)
    .map((day) => scoreOn(day)?.score)
    .filter((value): value is number => value != null);
  let lowStreak = 0;
  for (let ago = 0; ago < 30; ago += 1) {
    const score = scoreOn(addDays(c.date, -ago));
    if (!score || score.band === "green") break;
    lowStreak += 1;
  }
  const base = {
    score: today?.score ?? null,
    band: today?.band ?? null,
    trend7,
    vsPrior7: today && prior.length ? Math.round(today.score - mean(prior)) : null,
    lowStreak
  };
  if (!today) return { ...base, status: "unknown", headline: "No recovery score yet today" };
  // Yellow is common for this owner; watch needs a run of low days under 50.
  const status: Status =
    today.band === "green" ? "good" : today.band === "red" ? "low" : lowStreak >= 3 && today.score < 50 ? "watch" : "ok";
  const headline = `${today.score}, ${today.band}${lowStreak >= 3 ? `, not green ${lowStreak} days running` : ""}`;
  return { ...base, status, headline };
}

type VitalSpec = {
  pick: (day: HealthDay) => number | null;
  usual: (values: number[]) => number;
  floor: number; // the smallest spread z is divided by
  past: (value: number, usual: number) => boolean;
  describe: (value: number, usual: number, streak: number) => string;
};

const VITALS: Record<"restingHr" | "hrv" | "sleepTemp" | "breathing" | "spo2", VitalSpec> = {
  restingHr: {
    pick: (day) => day.restingHr,
    usual: mean,
    floor: 1,
    past: (value, usual) => value - usual >= 3,
    describe: (value, usual, streak) => `Resting HR ${value}, usually ${Math.round(usual)}${streak >= 2 ? `, up ${streak} days` : ""}`
  },
  hrv: {
    pick: (day) => day.hrvMs,
    usual: median,
    floor: 5,
    past: (value, usual) => value <= usual * 0.8,
    describe: (value, usual) => `HRV ${Math.round(value)} ms, usually ${Math.round(usual)}`
  },
  sleepTemp: {
    pick: (day) => day.sleepTempVsBaselineC,
    usual: mean,
    floor: 0.2,
    past: (value) => value >= 0.4,
    describe: (value) => `Sleep temperature ${fahrenheitDelta(value)}`
  },
  breathing: {
    pick: (day) => day.breathsPerMin,
    usual: mean,
    floor: 0.3,
    past: (value, usual) => value - usual >= 1,
    describe: (value, usual) => `Breathing ${value.toFixed(1)}/min, usually ${usual.toFixed(1)}`
  },
  spo2: {
    pick: (day) => day.spo2Pct,
    usual: mean,
    floor: 0.5,
    past: (value, usual) => value - usual <= -2,
    describe: (value, usual) => `SpO2 ${round(value, 1)}%, usually ${round(usual, 1)}`
  }
};

function vitalOf(c: Context, spec: VitalSpec) {
  const on = (date: string) => {
    const value = c.healthByDay.get(date) ? spec.pick(c.healthByDay.get(date)!) : null;
    const base = baselineDays(c.healthByDay, date, c.sickDates);
    const values = (base ?? []).map(spec.pick).filter((item): item is number => item != null);
    const usual = values.length >= 14 ? spec.usual(values) : null;
    return { value, usual, sd: values.length >= 14 ? spread(values) : null };
  };
  const today = on(c.date);
  let streak = 0;
  for (let ago = 0; ago < 14; ago += 1) {
    const day = on(addDays(c.date, -ago));
    if (day.value == null || day.usual == null || !spec.past(day.value, day.usual)) break;
    streak += 1;
  }
  const delta = today.value != null && today.usual != null ? today.value - today.usual : null;
  const vital: Vital = {
    value: today.value,
    usual: today.usual == null ? null : round(today.usual, 1),
    delta: delta == null ? null : round(delta, 1),
    z: delta == null || today.sd == null ? null : round(delta / Math.max(today.sd, spec.floor), 1),
    streak,
    trend7: lastDays(c.date, 7).map((day) => on(day).value)
  };
  const past = today.value != null && today.usual != null && spec.past(today.value, today.usual);
  return { vital, past, line: past ? spec.describe(today.value!, today.usual!, streak) : null };
}

function vitalsArea(c: Context): VitalsArea {
  const entries = Object.entries(VITALS).map(([name, spec]) => [name, vitalOf(c, spec)] as const);
  const byName = Object.fromEntries(entries.map(([name, result]) => [name, result.vital])) as Record<keyof typeof VITALS, Vital>;
  const past = entries.filter(([, result]) => result.past);
  const anyKnown = entries.some(([, result]) => result.vital.value != null && result.vital.usual != null);
  if (!anyKnown) return { ...byName, status: "unknown", headline: "Not enough watch data for a baseline" };
  const status: Status = byName.restingHr.streak >= 3 || past.length >= 2 ? "low" : past.length ? "watch" : "good";
  const headline = past.length ? past.slice(0, 2).map(([, result]) => result.line).join(" · ") : "All in your usual range";
  return { ...byName, status, headline };
}

function hardOn(c: Context, date: string) {
  return c.sources.sessions.some(
    (session) => session.date === date && session.muscleGroups.some((name) => intensityOf(session, name) === "hard")
  );
}

function loadArea(c: Context): LoadArea {
  const strainOn = (date: string) => dayStrain(c.healthByDay.get(date), c.workoutsByDay.get(date) ?? []);
  const average = (days: string[]) => {
    const values = days.map(strainOn).filter((value): value is number => value != null);
    return values.length ? round(mean(values), 1) : null;
  };
  const strainYesterday = strainOn(c.yesterday);
  const strain7 = average(lastDays(c.yesterday, 7));
  const strain28 = average(lastDays(c.yesterday, 28));
  const loadRatio = strain7 != null && strain28 ? round(strain7 / strain28, 2) : null;
  let hardStreak = 0;
  while (hardStreak < 14 && hardOn(c, addDays(c.yesterday, -hardStreak))) hardStreak += 1;
  let daysSinceRest = 0;
  while (daysSinceRest < 30) {
    const day = addDays(c.yesterday, -daysSinceRest);
    const strength = c.sources.sessions.some((session) => session.date === day && session.workoutType === "strength");
    const strain = strainOn(day);
    if (!strength && (strain == null || strain < 10)) break;
    daysSinceRest += 1;
  }
  const trend7 = lastDays(c.date, 7).map(strainOn);
  const base = { strainYesterday, strain7, strain28, loadRatio, hardStreak, daysSinceRest, trend7 };
  if (strain7 == null) return { ...base, status: "unknown", headline: "No strain data this week" };
  const reasons = [
    hardStreak >= 2 ? `${hardStreak} hard days in a row` : null,
    loadRatio != null && loadRatio > 1.3 ? `load up sharply (${loadRatio}× your usual)` : null,
    daysSinceRest >= 6 ? `${daysSinceRest} days without a rest day` : null
  ].filter((reason): reason is string => Boolean(reason));
  if (reasons.length) return { ...base, status: "watch", headline: reasons.join(", ").replace(/^./, (letter) => letter.toUpperCase()) };
  return { ...base, status: "good", headline: strainYesterday != null ? `Strain ${strainYesterday} yesterday, normal week` : "Normal week" };
}

function illnessArea(c: Context, vitals: VitalsArea, explanations: Explanation[]): IllnessArea {
  const days = c.illnessDays;
  const signal = illnessSignal(c.sources.health, c.date, c.sickDates);
  const sick = sickOn(days, c.date);
  const easing = easingOn(days, c.date);
  const answered = days.some((day) => day.date === c.date);
  // An explanation only counts when it moves what drove the signal (its
  // first reason): work stress can explain a low HRV, not a raised resting HR.
  const driver = signal.reasons[0] ?? "";
  const drives = driver.startsWith("Resting HR")
    ? "resting_hr"
    : driver.startsWith("HRV")
      ? "hrv"
      : driver.startsWith("Sleep temperature")
        ? "sleep_temp"
        : null;
  const fits = drives ? explanations.filter((item) => item.affects.includes(drives)) : [];
  const told = sick
    ? {
        severity: sick.severity,
        symptoms: sick.symptoms,
        since: sick.since,
        day: sick.dayNumber,
        reportedOn: sick.episode.last,
        source: (c.journalSick.has(sick.episode.last) ? "journal" : "logged") as "journal" | "logged"
      }
    : null;
  const signalOut = { level: signal.level, points: signal.points, reasons: signal.reasons };
  const early = !answered && (signal.level === "likely" || (signal.level === "possible" && !fits.length));

  if (sick) {
    const symptoms = sick.symptoms.length ? `: ${sick.symptoms.join(", ")}` : "";
    return {
      status: "low",
      headline: `${SEVERITY_LABELS[sick.severity]}, day ${sick.dayNumber} (since ${dayName(sick.since)})${symptoms}`,
      signal: signalOut,
      told,
      phase: "sick",
      phaseSince: sick.since,
      explainedBy: []
    };
  }
  if (easing) {
    return {
      status: "ok",
      headline: "Easing back after being sick",
      signal: signalOut,
      told,
      phase: "recovering",
      phaseSince: easing.ended ?? addDays(easing.last, 1),
      explainedBy: []
    };
  }
  const explainedBy = signal.level !== "none" ? fits.map((item) => item.detail) : [];
  if (early) {
    let first = c.date;
    for (let ago = 1; ago < 7; ago += 1) {
      const day = addDays(c.date, -ago);
      if (illnessSignal(c.sources.health, day, c.sickDates).level === "none") break;
      first = day;
    }
    const likelyNote = explainedBy.length ? ` (${explainedBy[0]} may explain some of it)` : "";
    return {
      status: "watch",
      headline: `Early signs: ${signal.reasons.slice(0, 2).join(" · ")}${likelyNote}`,
      signal: signalOut,
      told,
      phase: "early_signs",
      phaseSince: first,
      explainedBy
    };
  }
  const headline = explainedBy.length ? `Vitals up, likely ${explainedBy[0]}` : "No signs of illness";
  return {
    status: vitals.status === "unknown" ? "unknown" : "good",
    headline,
    signal: signalOut,
    told,
    phase: "well",
    phaseSince: null,
    explainedBy
  };
}

const GROUP_KEYS: Record<string, string> = {
  "Push day": "push",
  "Pull day": "pull",
  "Leg day": "legs",
  "Arm day": "arms",
  "Shoulder day": "shoulders"
};

const MAIN_GROUPS = ["push", "pull", "legs"];

// What the illness phase means for Next up (suggestNext): sick is rest or
// light, easing back and early signs keep it off hard. Training reads it too.
export function illnessStateOf(illness: Pick<IllnessArea, "phase" | "told">): IllnessState {
  if (illness.phase === "sick" && illness.told) {
    return { kind: "sick", severity: illness.told.severity, label: SEVERITY_LABELS[illness.told.severity] };
  }
  return illness.phase === "recovering" ? { kind: "easing" } : illness.phase === "early_signs" ? { kind: "watch" } : null;
}

function trainingArea(c: Context, illness: IllnessArea): TrainingArea {
  const { sessions, soreness, fitbit } = c.sources;
  const next = suggestNext(sessions, c.date, soreness, undefined, illnessStateOf(illness));
  const outBy = new Map(next.out.map((item) => [item.muscle, item.because ?? SORENESS_LEVELS[sorenessStep(item.level)].toLowerCase()]));
  const muscles: MuscleState[] = TRACKED_MUSCLES.map((muscle) => {
    const week = muscleWeekOf(sessions, soreness, muscle, c.date);
    const since = lastHitOf(sessions, muscle, c.date).since;
    const told = soreness.some((report) => report.muscle === muscle && report.date >= c.yesterday);
    return {
      muscle,
      soreness: round(week.soreness, 2),
      sorenessSource: week.soreness > 0.5 ? (told ? "told" : "workout") : null,
      points7: week.points,
      daysSinceHit: since >= 30 ? null : since,
      readyIn: week.readyIn,
      out: outBy.get(muscle) ?? null
    };
  });
  const sinceOf = new Map(muscles.map((item) => [item.muscle, item.daysSinceHit]));
  // A day type's days since: its middle muscle, so lower back worked on back
  // day doesn't make legs look recent. Null when most weren't hit in 30 days.
  const groupSince = (list: readonly TrackedMuscle[]) => {
    const days = list.map((muscle) => sinceOf.get(muscle) ?? 99).sort((a, b) => a - b);
    const middle = days[Math.floor((days.length - 1) / 2)];
    return middle >= 30 ? null : middle;
  };
  const groups: Record<string, number | null> = Object.fromEntries(
    DAY_TYPES.map((type) => [GROUP_KEYS[type.name] ?? type.name.toLowerCase(), groupSince(type.muscles)])
  );
  groups.core = groupSince(trackedOf("Core"));
  const due = next.fresh.filter((item) => item.since >= DUE_AFTER_DAYS).map((item) => item.muscle);
  const split = splitOf(splitKinds(sessions, fitbit, addDays(c.date, -6), c.date)).map((entry) => ({
    kind: entry.kind,
    count: entry.count,
    target: entry.target
  }));
  const suggested = {
    name: next.pick?.name ?? null,
    work: next.pick?.work.map(({ muscle, intensity }) => ({ muscle, intensity })) ?? [],
    note: next.illness?.note ?? null
  };
  const base = { muscles, groups, due, split, suggested };
  if (!sessions.length) return { ...base, status: "unknown", headline: "No workouts logged in 30 days" };
  // Watch when a whole day type has gone a week: one muscle slipping is
  // normal, legs untouched for 8 days is the weekly goal slipping.
  // Push, pull and legs only: arm and shoulder days are optional picks.
  const slipping = Object.entries(groups)
    .filter(([name, days]) => MAIN_GROUPS.includes(name) && (days == null || days >= 7))
    .sort(([, a], [, b]) => (b ?? 99) - (a ?? 99));
  if (slipping.length) {
    const [name, days] = slipping[0];
    const label = name.replace(/^./, (letter) => letter.toUpperCase());
    const more = slipping.length > 1 ? ` (and ${slipping.slice(1).map(([other]) => other).join(", ")})` : "";
    return { ...base, status: "watch", headline: `${label}: ${days == null ? "not worked in 30 days" : `${days} days since last worked`}${more}` };
  }
  return { ...base, status: "good", headline: due.length ? `${due.slice(0, 3).join(", ")} due` : "Nothing due yet" };
}

function fuelArea(c: Context): FuelArea {
  const { meals, goals, health, healthWorkouts, water } = c.sources;
  const dayOf = (date: string): FuelDay => {
    const entries = meals.filter((meal) => meal.entry_date === date);
    if (!entries.length) return null;
    const totals = summarizeEntries(entries);
    const kcal = workoutCalories(
      healthWorkouts.filter((workout) => workout.day === date),
      restingKcalPerMinute(health, date)
    );
    const target = withWorkoutCalories(goals, kcal);
    const caffeine = caffeineDay(entries, goals);
    return {
      calories: Math.round(totals.calories),
      caloriesTarget: target.calories,
      proteinG: Math.round(totals.protein_g),
      proteinTarget: gramsFromPercentGoals(target).protein_g,
      waterOz: water[date] ?? null,
      waterTarget: goals.waterOz,
      caffeineMg: caffeine.mg,
      caffeineLast: caffeine.last,
      caffeineLate: caffeine.late,
      addedSugarG: sugarDay(entries, goals).g
    };
  };
  const yesterday = dayOf(c.yesterday);
  const today = dayOf(c.date);
  let proteinStreak = 0;
  for (let ago = 1; ago <= 7; ago += 1) {
    const day = dayOf(addDays(c.date, -ago));
    if (!day || day.proteinG >= day.proteinTarget * 0.8) break;
    proteinStreak += 1;
  }
  const base = { yesterday, today, proteinStreak };
  if (!yesterday) return { ...base, status: "unknown", headline: "No meals logged yesterday" };
  const line = `Yesterday ${yesterday.calories} of ${yesterday.caloriesTarget} kcal, protein ${yesterday.proteinG} of ${yesterday.proteinTarget} g`;
  if (proteinStreak >= 3) return { ...base, status: "watch", headline: `Protein under target ${proteinStreak} days running` };
  if (yesterday.calories < yesterday.caloriesTarget * 0.7) return { ...base, status: "watch", headline: line };
  return { ...base, status: "good", headline: line };
}

// ---------- Mental ----------

const byNewest = (a: JournalEntry, b: JournalEntry) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

function moodArea(c: Context): MoodArea {
  const entries = [...c.sources.journal].sort(byNewest);
  const recent = entries.filter((entry) => entry.date >= c.yesterday && entry.date <= c.date);
  const latest = (rating: "mood" | "stress" | "energy") => {
    const entry = recent.find((item) => item.ratings[rating] != null);
    return entry ? { value: entry.ratings[rating]!, date: entry.date } : null;
  };
  const mood = latest("mood");
  const stress = latest("stress");
  const energy = latest("energy");
  const moodOn = (date: string) => entries.find((entry) => entry.date === date && entry.ratings.mood != null)?.ratings.mood ?? null;
  const trend7 = lastDays(c.date, 7).map(moodOn);
  let lowStreak = 0;
  for (const value of [...trend7].reverse()) {
    if (value == null) continue;
    if (value > 2) break;
    lowStreak += 1;
  }
  const lastEntries = entries
    .filter((entry) => entry.date <= c.date)
    .slice(0, 2)
    .map((entry) => ({ id: entry.id, date: entry.date, kind: entry.kind }));
  const base = { mood, stress, energy, trend7, lowStreak, lastEntries };
  if (!mood) return { ...base, status: "unknown", headline: "No mood in the last 2 days" };
  const status: Status =
    mood.value === 1 || lowStreak >= 3
      ? "low"
      : mood.value === 2 || (stress?.value ?? 0) >= 4
        ? "watch"
        : mood.value >= 4 && (stress?.value ?? 0) < 3
          ? "good"
          : "ok";
  const extra = [
    energy && energy.value <= 2 ? `energy ${ENERGY_LABELS[energy.value - 1].toLowerCase()}` : null,
    stress && stress.value >= 4 ? `stress ${stress.value}` : null,
    lowStreak >= 3 ? `low ${lowStreak} days running` : null
  ].filter(Boolean);
  const headline = `Mood ${mood.value} (${MOOD_LABELS[mood.value - 1].toLowerCase()})${extra.length ? `, ${extra.join(", ")}` : ""}`;
  return { ...base, status, headline };
}

// ---------- Lifestyle ----------

// Until habits carry an `affects` flag (docs/body-state.md, Open questions),
// drinking is recognized by name.
const DRINKING = /\b(drinks?|drinking|alcohol|beers?|wine|booze|liquor)\b/i;
export const affectsBody = (habit: Pick<Habit, "name" | "unit">) => DRINKING.test(habit.name) || DRINKING.test(habit.unit ?? "");

function habitsArea(c: Context): { area: HabitsArea; explanations: Explanation[] } {
  const active = c.sources.habits.filter((habit) => habit.active);
  const logsOn = (date: string) => c.sources.habitLogs.filter((log) => log.date === date);
  const yesterdayDays = summarizeHabitDay(active, c.yesterday, logsOn(c.yesterday));
  const yesterday = yesterdayDays
    .map((day) => ({ day, outcome: habitOutcome(day) }))
    .filter((item) => item.outcome !== "off")
    .map(({ day, outcome }) => ({ habit: day.habit.name, outcome, level: day.level, lateMinutes: day.lateMinutes }));
  const missStreaks = active
    .filter((habit) => {
      const outcomes: string[] = [];
      for (let ago = 1; ago <= 10 && outcomes.length < 5; ago += 1) {
        const date = addDays(c.date, -ago);
        if (!trackedOn(habit, date)) continue;
        outcomes.push(habitOutcome(summarizeHabitDay([habit], date, logsOn(date))[0]));
      }
      return outcomes.filter((outcome) => outcome.startsWith("miss")).length >= 3;
    })
    .map((habit) => habit.name);
  const explanations: Explanation[] = yesterdayDays
    .filter((day) => day.status === "used" && day.level > 0 && affectsBody(day.habit))
    .map((day) => ({
      kind: "habit",
      detail: `${formatHabitAmount(day.habit, day.level)}${day.latestEnd ? ` until ${formatClockTime(day.latestEnd)}` : ""} last night`,
      affects: ["sleep", "resting_hr", "hrv", "sleep_temp", "recovery"],
      source: "lifestyle.habits"
    }));
  const logged = yesterday.filter((item) => item.outcome !== "unknown");
  const base = { yesterday, missStreaks };
  if (!logged.length) return { area: { ...base, status: "unknown", headline: "No habits logged yesterday" }, explanations };
  const misses = logged.filter((item) => item.outcome.startsWith("miss"));
  if (missStreaks.length || explanations.length) {
    const headline = explanations.length
      ? explanations[0].detail.replace(/^./, (letter) => letter.toUpperCase())
      : `${missStreaks[0]}: missed 3 of the last 5 days`;
    return { area: { ...base, status: "watch", headline }, explanations };
  }
  if (!misses.length) return { area: { ...base, status: "good", headline: "All habits met yesterday" }, explanations };
  const met = logged.length - misses.length;
  return { area: { ...base, status: "ok", headline: `${met} of ${logged.length} habits met yesterday` }, explanations };
}

const TAGS = Object.fromEntries(TAG_CATEGORIES.map((category) => [category.id, new Set<string>(category.tags)])) as Record<
  string,
  Set<string>
>;

function careerArea(c: Context): CareerArea {
  const entries = [...c.sources.journal].filter((entry) => entry.date > addDays(c.date, -7) && entry.date <= c.date).sort(byNewest);
  const work = entries.filter((entry) => entry.tags.some((tag) => TAGS.work.has(tag)));
  const lately = work.filter((entry) => entry.date >= addDays(c.date, -2));
  const workStress = lately
    .filter((entry) => entry.ratings.stress != null)
    .map((entry) => ({ value: entry.ratings.stress!, date: entry.date }));
  const workDays7 = new Set(work.map((entry) => entry.date)).size;
  const latest = work[0];
  const latestTag = latest ? { value: latest.tags.find((tag) => TAGS.work.has(tag))!, date: latest.date } : null;
  const base = { workStress, workDays7, latestTag };
  if (!workDays7) return { ...base, status: "unknown", headline: "Nothing about work in 7 days" };
  const burnout = lately.find((entry) => entry.tags.includes("burnout"));
  if (burnout) return { ...base, status: "low", headline: `Burnout (${dayName(burnout.date)})` };
  const high = workStress.find((item) => item.value >= 4);
  if (high) {
    const tag = latestTag && latestTag.value !== "work" ? `, ${latestTag.value} ${dayName(latestTag.date)}` : "";
    return { ...base, status: "watch", headline: `Work stress ${high.value}${tag}` };
  }
  return { ...base, status: "ok", headline: `Work on ${workDays7} of the last 7 days` };
}

function relationshipsArea(c: Context): RelationshipsArea {
  const entries = [...c.sources.journal].filter((entry) => entry.date > addDays(c.date, -7) && entry.date <= c.date).sort(byNewest);
  const recent = entries.flatMap((entry) =>
    entry.tags.filter((tag) => TAGS.relationships.has(tag)).map((tag) => ({ tag, date: entry.date, mood: entry.ratings.mood }))
  );
  const social = entries.filter((entry) => entry.tags.some((tag) => TAGS.social.has(tag)));
  const social7 = new Set(social.map((entry) => entry.date)).size;
  const base = { recent, social7 };
  if (!recent.length && !social7) return { ...base, status: "unknown", headline: "Nothing about people in 7 days" };
  const conflict = recent.find((item) => item.tag === "conflict" && item.date >= addDays(c.date, -2));
  if (conflict) return { ...base, status: "watch", headline: `Conflict (${dayName(conflict.date)})` };
  const warm =
    recent.some((item) => (item.mood ?? 0) >= 4) || social.some((entry) => (entry.ratings.mood ?? 0) >= 4);
  const latest = recent[0] ?? (social[0] ? { tag: social[0].tags.find((tag) => TAGS.social.has(tag))!, date: social[0].date } : null);
  const headline = latest ? `${latest.tag.replace(/^./, (letter) => letter.toUpperCase())} ${dayName(latest.date)}` : "";
  return { ...base, status: warm ? "good" : "ok", headline: social7 > 1 ? `${headline}, social ${social7} days this week` : headline };
}

// ---------- Explanations ----------

function otherExplanations(c: Context, sleep: SleepArea, load: LoadArea, career: CareerArea, fuel: FuelArea): Explanation[] {
  const list: Explanation[] = [];
  // Last night's sleep follows yesterday's caffeine: late, or over the limit.
  const yesterday = fuel.yesterday;
  if (yesterday?.caffeineMg != null && (yesterday.caffeineLate || yesterday.caffeineMg > c.sources.goals.caffeineLimitMg)) {
    const late = yesterday.caffeineLate && yesterday.caffeineLast ? ` until ${formatClockTime(yesterday.caffeineLast)}` : "";
    list.push({ kind: "caffeine", detail: `${yesterday.caffeineMg} mg of caffeine yesterday${late}`, affects: ["sleep", "recovery"], source: "physical.fuel" });
  }
  if ((sleep.bedtimeDrift7n ?? 0) >= 90) {
    list.push({ kind: "late_night", detail: `a late night (${hm(sleep.bedtimeDrift7n!)} past your usual bedtime)`, affects: ["sleep", "recovery"], source: "physical.sleep" });
  }
  if (load.status === "watch") {
    list.push({ kind: "load", detail: load.headline.toLowerCase(), affects: ["resting_hr", "hrv", "recovery"], source: "physical.load" });
  }
  const workHigh = career.workStress.find((item) => item.value >= 4);
  const anyHigh = c.sources.journal.find(
    (entry) => entry.date >= c.yesterday && entry.date <= c.date && (entry.ratings.stress ?? 0) >= 4
  );
  if (workHigh || anyHigh) {
    const value = workHigh?.value ?? anyHigh!.ratings.stress!;
    list.push({ kind: "stress", detail: `${workHigh ? "work " : ""}stress ${value}`, affects: ["sleep", "hrv", "recovery"], source: workHigh ? "lifestyle.career" : "mental.mood" });
  }
  return list;
}

// ---------- The whole state ----------

export function buildBodyState(
  sources: BodySources,
  date: string,
  options: { trigger?: BodyState["meta"]["trigger"]; builtAt?: string } = {}
): BodyState {
  const workoutsByDay = new Map<string, HealthWorkout[]>();
  for (const workout of sources.healthWorkouts) workoutsByDay.set(workout.day, [...(workoutsByDay.get(workout.day) ?? []), workout]);
  const c: Context = {
    date,
    yesterday: addDays(date, -1),
    sources,
    healthByDay: new Map(sources.health.map((day) => [day.day, day])),
    workoutsByDay,
    sickDates: new Set(),
    illnessDays: [],
    journalSick: new Set()
  };
  const fromJournal = journalSickDays(sources.journal, sources.illness);
  c.illnessDays = [...sources.illness, ...fromJournal].sort((a, b) => a.date.localeCompare(b.date));
  c.journalSick = new Set(fromJournal.map((day) => day.date));
  c.sickDates = new Set(c.illnessDays.filter((day) => day.severity > 0).map((day) => day.date));

  const sleep = sleepArea(c);
  const recovery = recoveryArea(c);
  const vitals = vitalsArea(c);
  const load = loadArea(c);
  const fuel = fuelArea(c);
  const mood = moodArea(c);
  const { area: habits, explanations: habitExplanations } = habitsArea(c);
  const career = careerArea(c);
  const relationships = relationshipsArea(c);
  const explanations = [...habitExplanations, ...otherExplanations(c, sleep, load, career, fuel)];
  // A low recovery or short sleep says what likely caused it.
  const recoveryCause = explanations.find((item) => item.affects.includes("recovery"));
  if (recoveryCause && (recovery.status === "low" || recovery.status === "watch")) recovery.headline += `, after ${recoveryCause.detail}`;
  const sleepCause = explanations.find((item) => item.affects.includes("sleep") && item.kind !== "late_night");
  if (sleepCause && (sleep.status === "low" || sleep.status === "watch")) sleep.headline += `, after ${sleepCause.detail}`;
  const illness = illnessArea(c, vitals, explanations);
  const training = trainingArea(c, illness);

  const today = c.healthByDay.get(date);
  const missing = [
    !today ? "watch" : null,
    sleep.minutes == null ? "sleep" : null,
    today && today.hrvMs == null ? "hrv" : null,
    !fuel.yesterday ? "meals" : null,
    !sources.journal.some((entry) => entry.date >= c.yesterday && entry.date <= date) ? "journal" : null,
    habits.status === "unknown" ? "habits" : null
  ].filter((item): item is string => Boolean(item));

  const physicalAreas = { sleep, recovery, vitals, illness, load, training, fuel };
  const lifestyleAreas = { habits, career, relationships };
  return {
    meta: {
      date,
      schemaVersion: SCHEMA_VERSION,
      builtAt: options.builtAt ?? new Date().toISOString(),
      trigger: options.trigger ?? "live",
      dataThrough: sources.lastSync?.status === "succeeded" ? sources.lastSync.startedAt : null,
      lastNightIn: sleep.minutes != null,
      missing
    },
    // How the body is, not what's due: training keeps its own status but
    // doesn't set the domain's. Ties go to the first listed.
    physical: { ...physicalHead([illness, recovery, vitals, sleep, load, fuel], [recovery, sleep, vitals, illness, load, fuel]), ...physicalAreas },
    mental: { ...worstOf([mood]), mood },
    lifestyle: { ...worstOf(Object.values(lifestyleAreas)), ...lifestyleAreas },
    explanations
  };
}
