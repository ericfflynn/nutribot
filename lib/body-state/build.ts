// buildBodyState: every source for a day into one body state. Pure, so it's
// unit-tested and gives the same answer for the same data. Each area's status
// rule is in docs/body-state.md; change both together.
import { addDays, weekdayOf } from "../dates";
import { gramsFromPercentGoals, restingKcalPerMinute, withWorkoutCalories, workoutCalories } from "../goals";
import { baselineDays, illnessSignal } from "../health/illness";
import type { HealthDay, HealthWorkout } from "../health/queries";
import { SLEEP_NEED_MINUTES, dayStrain, recoveryScore, sleepScoresFor, type SleepScore } from "../health/scores";
import { formatClockTime, formatHabitAmount, habitOutcome, summarizeHabitDay, trackedOn, type Habit } from "../habits";
import { SEVERITY_LABELS } from "../illness-days";
import { ailmentLine, illnessDates, limitsLine, musclesLine, openAilmentsOn, type OpenAilment } from "../ailments-core";
import { ENERGY_LABELS, MOOD_LABELS, type JournalEntry } from "../journal";
import { tagsOf, type Tag } from "../journal-tags";
import { summarizeEntries } from "../supabase";
import { caffeineDay, sugarDay } from "../nutrients";
import {
  DAY_TYPES,
  DUE_AFTER_DAYS,
  SORENESS_LEVELS,
  TRACKED_MUSCLES,
  intensityOf,
  daysSinceWorked,
  recentHitDays,
  muscleWeekOf,
  sorenessStep,
  splitKinds,
  weekStartOf,
  splitOf,
  suggestNext,
  trackedOf,
  type IllnessState,
  type MuscleLimits,
  type Readiness,
  type TrackedMuscle
} from "../workouts";
import {
  SCHEMA_VERSION,
  type BodySources,
  type BodyState,
  type AilmentsArea,
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
import { ZONES, ZONE_GOALS, zoneMinutes, zonePace } from "../health/zones";

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

type Context = {
  date: string;
  yesterday: string;
  sources: BodySources;
  healthByDay: Map<string, HealthDay>;
  workoutsByDay: Map<string, HealthWorkout[]>;
  sickDates: Set<string>; // days an illness covered, for baselines and sleep need
  open: OpenAilment[]; // ailments open or easing on the date, worst first
  sleepScores: Map<string, SleepScore>; // every night in the health window
};

// The physical domain's head: when something's wrong, illness speaks first;
// on an ok or good day, recovery does ("89, green" over "No signs of illness").
function physicalHead(problemOrder: Head[], fineOrder: Head[]): Head {
  const worst = worstOf(problemOrder);
  if (worst.status === "low" || worst.status === "watch" || worst.status === "unknown") return worst;
  return { status: worst.status, headline: fineOrder.find((head) => head.status === worst.status)!.headline };
}

// ---------- Physical ----------

// The inverse of eveningMinutes, as "HH:MM".
function clockOf(evening: number) {
  const total = Math.round(evening + 18 * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function usualClock(times: (string | null | undefined)[]) {
  const known = times.filter((value): value is string => Boolean(value)).map(eveningMinutes);
  return known.length >= 7 ? clockOf(median(known)) : null;
}

// Sleep status thresholds (calibrated October 31, 2026; docs/body-state.md).
const GOOD_SLEEP = 90;
const IRREGULAR = 80;

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
  const scored = c.sleepScores.get(c.date) ?? null;
  const pct = scored?.durationPct ?? null;
  const consistency7n = scored?.consistency ?? null;
  const baseline28 = lastDays(addDays(c.date, -1), 28);
  const base = {
    minutes,
    needMinutes: scored?.need.minutes ?? SLEEP_NEED_MINUTES,
    need: scored?.need ?? null,
    score: scored?.score ?? null,
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
        awake: day?.awakeMinutes ?? null,
        bedtime: day?.bedtime?.slice(11, 16) ?? null,
        wakeTime: day?.wakeTime?.slice(11, 16) ?? null
      };
    }),
    usualBedtime: usualClock(baseline28.map((day) => c.healthByDay.get(day)?.bedtime)),
    usualWakeTime: usualClock(baseline28.map((day) => c.healthByDay.get(day)?.wakeTime)),
    debt3n,
    bedtimeDrift7n,
    consistency7n
  };
  if (minutes == null || pct == null) return { ...base, status: "unknown", headline: "Last night's sleep hasn't synced" };
  // A short night against need is low or watch; an irregular week
  // (consistency under IRREGULAR) keeps an otherwise long one from good.
  const irregular = consistency7n != null && consistency7n < IRREGULAR;
  const score = scored!.score;
  const status: Status =
    pct < 60 ? "low" : pct < 75 || (debt3n ?? 0) >= 120 ? "watch" : score >= GOOD_SLEEP && (debt3n ?? 0) < 60 && !irregular ? "good" : "ok";
  const parts = [`${hm(minutes)}, sleep score ${score} (${pct}% of a ${hm(base.needMinutes)} need)`];
  if ((debt3n ?? 0) >= 60) parts.push(`${hm(debt3n!)} short over 3 nights`);
  if ((bedtimeDrift7n ?? 0) >= 60) parts.push(`to bed ${hm(bedtimeDrift7n!)} later than usual`);
  if (irregular) parts.push(`bed and wake times irregular this week (${consistency7n}% consistent)`);
  return { ...base, status, headline: parts.join(", ") };
}

function recoveryArea(c: Context): RecoveryArea {
  const days = [...c.sources.health].sort((a, b) => a.day.localeCompare(b.day));
  const scoreOn = (date: string) => {
    const index = days.findIndex((day) => day.day === date);
    if (index < 0 || days[index].hrvMs == null || days[index].restingHr == null) return null;
    return recoveryScore(days.slice(0, index + 1), (day) => c.sleepScores.get(day)?.score ?? null);
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

// The day strain from which a day counts as hard: Whoop's strenuous band.
const STRENUOUS_STRAIN = 14;

// A hard day: a session logged hard, or a strenuous day on the watch.
function hardOn(c: Context, date: string) {
  const strain = dayStrain(c.healthByDay.get(date), c.workoutsByDay.get(date) ?? []);
  return (
    (strain ?? 0) >= STRENUOUS_STRAIN ||
    c.sources.sessions.some((session) => session.date === date && session.muscleGroups.some((name) => intensityOf(session, name) === "hard"))
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

// The illness phase: sick while an illness is open, easing back after one
// that reached Sick, early signs when the watch flags a day nothing explains
// and nothing answers. Illnesses are ailments (docs/ailments.md).
function illnessArea(c: Context, vitals: VitalsArea, explanations: Explanation[]): IllnessArea {
  const signal = illnessSignal(c.sources.health, c.date, c.sickDates);
  const sick = c.open.find((item) => item.kind === "illness" && item.phase === "active") ?? null;
  const easing = c.open.find((item) => item.kind === "illness" && item.phase === "easing") ?? null;
  // Answered today: a "fine" answer, or any illness report for today.
  const answered =
    c.sources.illness.some((day) => day.date === c.date) ||
    c.sources.ailments.some((item) => item.kind === "illness" && item.days.some((day) => day.date === c.date));
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
        day: sick.day,
        reportedOn: sick.reportedOn ?? sick.since,
        source: "ailment" as const,
        name: sick.name
      }
    : null;
  const signalOut = { level: signal.level, points: signal.points, reasons: signal.reasons };
  const early = !answered && (signal.level === "likely" || (signal.level === "possible" && !fits.length));

  if (sick) {
    const symptoms = sick.symptoms.length ? `: ${sick.symptoms.join(", ")}` : "";
    return {
      status: "low",
      headline: `${sick.name}, ${SEVERITY_LABELS[sick.severity].toLowerCase()}, day ${sick.day} (since ${dayName(sick.since)})${symptoms}`,
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
      headline: `Easing back after ${easing.name.toLowerCase()}`,
      signal: signalOut,
      told,
      phase: "recovering",
      phaseSince: addDays(easing.since, easing.day),
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

// Every ailment open on the day (docs/ailments.md): low with an illness at
// Sick or anything at its worst (3), watch with anything open, ok while only
// easing back.
function ailmentsArea(c: Context): AilmentsArea {
  const open = c.open;
  const ended7 = c.sources.ailments
    .filter((item) => item.endedOn && item.endedOn <= c.date && item.endedOn > addDays(c.date, -7))
    .map((item) => ({ id: item.id, name: item.name, endedOn: item.endedOn! }));
  const active = open.filter((item) => item.phase === "active");
  if (!open.length) return { status: "good", headline: "Nothing open", open, ended7 };
  const low = active.some((item) => item.severity >= 3 || (item.kind === "illness" && item.severity >= 2));
  const more = open.length > 1 ? ` (+${open.length - 1} more)` : "";
  return { status: low ? "low" : active.length ? "watch" : "ok", headline: `${ailmentLine(open[0])}${more}`, open, ended7 };
}

// What the rule-based pick (Next up's default and fallback) steers around
// for open injuries and pain. The rules can't weigh an ailment, so they stay
// cautious: no day is picked for the muscles it affects, and a bad one rests
// its region. Claude's call weighs the same ailments itself; only the bad
// one's limits are hard (guardrailsOf).
export function ailmentAvoidOf(open: readonly OpenAilment[]): MuscleLimits {
  const muscles: MuscleLimits["muscles"] = new Map();
  let noHard: string | null = null;
  const notes: string[] = [];
  for (const item of open) {
    if (item.phase !== "active" || item.kind === "illness") continue;
    const tag = item.name.toLowerCase();
    for (const muscle of item.limits.out) muscles.set(muscle, { max: null, because: `${tag}, resting` });
    for (const muscle of item.affects) if (!muscles.has(muscle)) muscles.set(muscle, { max: "light", because: tag });
    if (item.limits.noHard) noHard ??= item.name;
    const hard = limitsLine(item.limits);
    notes.push(hard ? `${item.name}: ${hard.toLowerCase()}.` : `${item.name}: skipping ${musclesLine(item.affects)} work.`);
  }
  return { muscles, noHard, note: notes.join(" ") || null };
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

// How ready the body is to train today (docs/body-state.md, Training): points
// for what's against it; 2 or more is an easy day, 4 or more a rest day.
// Nov 3, 2026 (red recovery after 4 drinks, three strenuous days, a big
// food day) is 7, a rest day; it had picked leg day.
export function readinessOf(recovery: RecoveryArea, load: LoadArea, drinks: Explanation[], fuel: FuelArea): Readiness {
  const against: [number, string][] = [];
  if (recovery.band === "red") against.push([2, `recovery red (${recovery.score})`]);
  else if (recovery.band === "yellow") against.push([1, `recovery yellow (${recovery.score})`]);
  if (drinks.length) against.push([2, drinks[0].detail]);
  if (load.hardStreak >= 2) against.push([2, `${load.hardStreak} hard days in a row`]);
  else if (load.hardStreak === 1) against.push([1, "a hard day yesterday"]);
  const food = fuel.yesterday;
  if (
    food &&
    (food.calories > food.caloriesTarget * 1.2 || food.calories < food.caloriesTarget * 0.7 || food.proteinG < food.proteinTarget * 0.7)
  ) {
    against.push([1, "a rough food day yesterday"]);
  }
  const points = against.reduce((sum, [value]) => sum + value, 0);
  return {
    level: points >= 4 ? "rest" : points >= 2 ? "easy" : "normal",
    reasons: [...against].sort((a, b) => b[0] - a[0]).map(([, reason]) => reason)
  };
}

const NOT_HIT = 99;

// Heart-rate zones (lib/health/zones.ts): this calendar week's watch-workout
// minutes, workouts only (the owner, Nov 10, 2026), ignored recordings left
// out, against the weekly goals and the 4 full weeks before.
function zonesOf(c: Context) {
  const ignored = new Set(c.sources.fitbit.filter((workout) => workout.ignored).map((workout) => workout.id));
  const start = weekStartOf(c.date);
  const minutesIn = (from: string, to: string) =>
    zoneMinutes(c.sources.healthWorkouts.filter((workout) => workout.day >= from && workout.day <= to && !ignored.has(workout.id)));
  const week = minutesIn(start, c.date);
  const past = [1, 2, 3, 4].map((ago) => minutesIn(addDays(start, -7 * ago), addDays(start, -7 * ago + 6)));
  const daysDone = Math.round((Date.parse(c.date) - Date.parse(start)) / 86_400_000);
  return ZONES.map((zone) => {
    const goal = ZONE_GOALS[zone.key];
    const pace = goal == null ? null : zonePace(week[zone.key], goal, daysDone);
    return {
      zone: zone.key,
      minutes: week[zone.key],
      goal,
      average: Math.round(past.reduce((sum, item) => sum + item[zone.key], 0) / past.length),
      status: pace?.status ?? null,
      behind: pace?.behind ?? 0
    };
  });
}

function trainingArea(c: Context, illness: IllnessArea, readiness: Readiness): TrainingArea {
  const { sessions, soreness, fitbit } = c.sources;
  const next = suggestNext(sessions, c.date, soreness, undefined, illnessStateOf(illness), readiness, ailmentAvoidOf(c.open));
  const outBy = new Map(next.out.map((item) => [item.muscle, item.because ?? SORENESS_LEVELS[sorenessStep(item.level)].toLowerCase()]));
  const muscles: MuscleState[] = TRACKED_MUSCLES.map((muscle) => {
    const week = muscleWeekOf(sessions, soreness, muscle, c.date);
    // Any work counts, today's too: the chat reads this right after a save.
    const hitDays = recentHitDays(sessions, muscle, c.date, 2).filter((days) => days < 30);
    const since = hitDays[0] ?? NOT_HIT;
    const told = soreness.some((report) => report.muscle === muscle && report.date >= c.yesterday);
    return {
      muscle,
      soreness: round(week.soreness, 2),
      sorenessSource: week.soreness > 0.5 ? (told ? "told" : "workout") : null,
      points7: week.points,
      daysSinceHit: since >= 30 ? null : since,
      recentHits: hitDays,
      readyIn: week.readyIn,
      out: outBy.get(muscle) ?? null
    };
  });
  // A day type's days since: its middle muscle, so lower back worked on back
  // day doesn't make legs look recent. Medium or hard work only, so a few
  // light pushups don't count as a push day. Null when most weren't hit in 30 days.
  const groupSince = (list: readonly TrackedMuscle[]) => {
    const days = list.map((muscle) => daysSinceWorked(sessions, muscle, c.date, "medium")).sort((a, b) => a - b);
    const middle = days[Math.floor((days.length - 1) / 2)];
    return middle >= 30 ? null : middle;
  };
  const groups: Record<string, number | null> = Object.fromEntries(
    DAY_TYPES.map((type) => [GROUP_KEYS[type.name] ?? type.name.toLowerCase(), groupSince(type.muscles)])
  );
  groups.core = groupSince(trackedOf("Core"));
  const due = next.fresh.filter((item) => item.since >= DUE_AFTER_DAYS).map((item) => item.muscle);
  // This calendar week's split (Monday through the day), like the 4-point target.
  const split = splitOf(splitKinds(sessions, fitbit, weekStartOf(c.date), c.date)).map((entry) => ({
    kind: entry.kind,
    count: entry.count,
    target: entry.target
  }));
  const suggested = {
    name: next.pick?.name ?? null,
    work: next.pick?.work.map(({ muscle, intensity }) => ({ muscle, intensity })) ?? [],
    note: [next.illness?.note, next.ailments?.note, next.readiness?.note].filter(Boolean).join(" ") || null
  };
  const base = { muscles, groups, due, split, suggested, readiness, zones: zonesOf(c) };
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

// ", work and money": what the journal said was behind stress on a day.
function stressFrom(c: Context, date: string) {
  const values = [
    ...new Set(c.sources.journal.filter((entry) => entry.date === date).flatMap((entry) => tagsOf(entry, "stressor").map((tag) => tag.value).filter(Boolean)))
  ];
  return values.length ? ` from ${values.join(" and ")}` : "";
}

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
    stress && stress.value >= 4 ? `stress ${stress.value}${stressFrom(c, stress.date)}` : null,
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

// Work from the journal's tags (docs/journal-tags.md): a `work` tag or stress
// from work. Low with stress 5 on a work day in 3 days, or stress from work 3
// days running; watch with work stress 4+ in 3 days, or work feeling bad on 3
// of the last 7 days.
function careerArea(c: Context): CareerArea {
  const entries = [...c.sources.journal].filter((entry) => entry.date > addDays(c.date, -7) && entry.date <= c.date).sort(byNewest);
  const isWork = (tag: Tag) => tag.key === "work" || (tag.key === "stressor" && tag.value === "work");
  const work = entries.filter((entry) => tagsOf(entry).some(isWork));
  const lately = work.filter((entry) => entry.date >= addDays(c.date, -2));
  const workStress = lately
    .filter((entry) => entry.ratings.stress != null)
    .map((entry) => ({ value: entry.ratings.stress!, date: entry.date }));
  const workDays7 = new Set(work.map((entry) => entry.date)).size;
  const feelings = work.flatMap((entry) => tagsOf(entry, "work").filter((tag) => tag.feeling).map((tag) => ({ feeling: tag.feeling!, date: entry.date })));
  const feel7 = {
    good: new Set(feelings.filter((item) => item.feeling === "good").map((item) => item.date)).size,
    bad: new Set(feelings.filter((item) => item.feeling === "bad").map((item) => item.date)).size
  };
  const latestWithValue = work.find((entry) => tagsOf(entry, "work").some((tag) => tag.value));
  const latestTag = latestWithValue ? { value: tagsOf(latestWithValue, "work").find((tag) => tag.value)!.value!, date: latestWithValue.date } : null;
  const base = { workStress, workDays7, latestTag, feel7 };
  if (!workDays7) return { ...base, status: "unknown", headline: "Nothing about work in 7 days" };
  const stressDays = new Set(
    entries.filter((entry) => tagsOf(entry, "stressor").some((tag) => tag.value === "work")).map((entry) => entry.date)
  );
  const runOf3 = [0, 1, 2].every((ago) => stressDays.has(addDays(c.date, -ago))) || [1, 2, 3].every((ago) => stressDays.has(addDays(c.date, -ago)));
  const peak = workStress.find((item) => item.value >= 5);
  if (peak || runOf3) return { ...base, status: "low", headline: peak ? `Work stress 5 (${dayName(peak.date)})` : "Stress from work 3 days running" };
  const high = workStress.find((item) => item.value >= 4);
  if (high) {
    const tag = latestTag ? `, ${latestTag.value} ${dayName(latestTag.date)}` : "";
    return { ...base, status: "watch", headline: `Work stress ${high.value}${tag}` };
  }
  if (feel7.bad >= 3) return { ...base, status: "watch", headline: `Work felt bad ${feel7.bad} of the last 7 days` };
  if (feel7.good > feel7.bad) return { ...base, status: "good", headline: `Work felt good ${feel7.good} of the last 7 days` };
  return { ...base, status: "ok", headline: `Work on ${workDays7} of the last 7 days` };
}

// People from the journal's `with` tags: watch when time with someone felt bad
// or stress came from the relationship or family in 3 days; good when time
// with someone felt good, or came with mood 4+.
function relationshipsArea(c: Context): RelationshipsArea {
  const entries = [...c.sources.journal].filter((entry) => entry.date > addDays(c.date, -7) && entry.date <= c.date).sort(byNewest);
  const recent = entries.flatMap((entry) =>
    tagsOf(entry, "with")
      .filter((tag) => tag.value && tag.value !== "alone" && tag.value !== "coworkers")
      .map((tag) => ({ tag: tag.value!, date: entry.date, mood: entry.ratings.mood, feeling: tag.feeling }))
  );
  const social7 = new Set(recent.filter((item) => item.tag !== "partner" && item.tag !== "family").map((item) => item.date)).size;
  const strain = entries.find(
    (entry) => entry.date >= addDays(c.date, -2) && tagsOf(entry, "stressor").some((tag) => tag.value === "relationship" || tag.value === "family")
  );
  const base = { recent, social7 };
  if (!recent.length && !strain) return { ...base, status: "unknown", headline: "Nothing about people in 7 days" };
  const bad = recent.find((item) => item.feeling === "bad" && item.date >= addDays(c.date, -2));
  if (bad || strain) {
    const what = bad ? `Time with ${bad.tag} felt bad (${dayName(bad.date)})` : `Stress from ${tagsOf(strain!, "stressor").find((tag) => tag.value === "relationship" || tag.value === "family")!.value} (${dayName(strain!.date)})`;
    return { ...base, status: "watch", headline: what };
  }
  const warm = recent.some((item) => item.feeling === "good" || (item.mood ?? 0) >= 4);
  const latest = recent[0];
  const headline = latest ? `With ${latest.tag} ${dayName(latest.date)}` : "";
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
    sickDates: illnessDates(sources.ailments, date),
    open: openAilmentsOn(sources.ailments, date),
    sleepScores: new Map()
  };
  c.sleepScores = sleepScoresFor(sources.health, sources.health.map((day) => day.day), workoutsByDay, c.sickDates);

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
  const ailments = ailmentsArea(c);
  const drinks = habitExplanations.filter((item) => item.kind === "habit");
  const training = trainingArea(c, illness, readinessOf(recovery, load, drinks, fuel));

  const today = c.healthByDay.get(date);
  const missing = [
    !today ? "watch" : null,
    sleep.minutes == null ? "sleep" : null,
    today && today.hrvMs == null ? "hrv" : null,
    !fuel.yesterday ? "meals" : null,
    !sources.journal.some((entry) => entry.date >= c.yesterday && entry.date <= date) ? "journal" : null,
    habits.status === "unknown" ? "habits" : null
  ].filter((item): item is string => Boolean(item));

  const physicalAreas = { sleep, recovery, vitals, illness, ailments, load, training, fuel };
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
    physical: { ...physicalHead([illness, ailments, recovery, vitals, sleep, load, fuel], [recovery, sleep, vitals, illness, ailments, load, fuel]), ...physicalAreas },
    mental: { ...worstOf([mood]), mood },
    lifestyle: { ...worstOf(Object.values(lifestyleAreas)), ...lifestyleAreas },
    explanations
  };
}
