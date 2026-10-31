// The body state: one daily picture of the owner's body and mind, in domains
// (physical, mental, lifestyle), areas and signals. Spec: docs/body-state.md.
// Bump SCHEMA_VERSION whenever a field changes meaning.
import type { HealthDay, HealthSyncRun, HealthWorkout } from "../health/queries";
import type { IllnessLevel } from "../health/illness";
import type { Habit, HabitLog, HabitOutcome } from "../habits";
import type { IllnessDay, Symptom } from "../illness-days";
import type { JournalEntry } from "../journal";
import type { Goals } from "../goals";
import type { SleepNeed } from "../health/scores";
import type { MacroEntry } from "../supabase";
import type { FitbitWorkout, Intensity, SorenessReport, TrackedMuscle, WorkoutSession } from "../workouts";

export const SCHEMA_VERSION = 1;

export const STATUSES = ["low", "watch", "ok", "good", "unknown"] as const;
export type Status = (typeof STATUSES)[number];

// Every domain and area starts with this.
export type Head = { status: Status; headline: string };

export type Dated<T> = { value: T; date: string };

export type Vital = {
  value: number | null; // today
  usual: number | null; // baseline: mean (median for HRV) of days −31 to −4, sick days left out
  delta: number | null; // value − usual
  z: number | null; // delta / baseline spread (floored)
  streak: number; // days in a row past the vital's threshold, today included
  trend7: (number | null)[]; // oldest first
};

export type SleepArea = Head & {
  minutes: number | null;
  needMinutes: number; // tonight's need (8 h until Oct 31, 2026)
  pct: number | null; // asleep / need, capped at 100
  bedtime: string | null; // local "HH:MM"
  wakeTime: string | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  lightMinutes: number | null;
  awakeMinutes: number | null;
  // The last 7 nights, oldest first, by stage (minutes; null when not synced).
  // bedtime and wakeTime ("HH:MM") were added Oct 31, 2026; older stored states lack them.
  nights7: {
    date: string;
    minutes: number | null;
    deep: number | null;
    light: number | null;
    rem: number | null;
    awake: number | null;
    bedtime?: string | null;
    wakeTime?: string | null;
  }[];
  // The usual night: median bedtime and wake time ("HH:MM") over the 28 nights
  // before last night, with at least 7 known (added Oct 31, 2026).
  usualBedtime?: string | null;
  usualWakeTime?: string | null;
  debt3n: number | null; // shortfall over the last 3 nights, minutes
  bedtimeDrift7n: number | null; // minutes past the 7-night median bedtime (negative: earlier)
  // Added Oct 31, 2026 (older stored states lack them): the sleep score, what
  // tonight's need was made of, and the 7-night Sleep Regularity Index.
  score?: number | null;
  need?: SleepNeed | null;
  consistency7n?: number | null;
};

export type RecoveryArea = Head & {
  score: number | null;
  band: "green" | "yellow" | "red" | null;
  trend7: (number | null)[];
  vsPrior7: number | null;
  lowStreak: number; // days in a row at yellow or red
};

export type VitalsArea = Head & {
  restingHr: Vital;
  hrv: Vital;
  sleepTemp: Vital;
  breathing: Vital;
  spo2: Vital;
};

export const ILLNESS_PHASES = ["sick", "recovering", "early_signs", "well"] as const;
export type IllnessPhase = (typeof ILLNESS_PHASES)[number];

export type IllnessArea = Head & {
  signal: { level: IllnessLevel; points: number; reasons: string[] };
  told: {
    severity: number;
    symptoms: Symptom[];
    since: string;
    day: number;
    reportedOn: string;
    source: "logged" | "journal"; // logged sick days, or a journal entry tagged "sick"
  } | null;
  phase: IllnessPhase;
  phaseSince: string | null;
  explainedBy: string[]; // explanation details that account for a raised signal
};

export type LoadArea = Head & {
  strainYesterday: number | null;
  strain7: number | null;
  strain28: number | null;
  loadRatio: number | null;
  hardStreak: number;
  daysSinceRest: number;
  trend7: (number | null)[]; // day strain, the 7 days to today (today partial), oldest first
};

export type MuscleState = {
  muscle: TrackedMuscle;
  soreness: number; // 0 fresh to 3 very sore, fading
  sorenessSource: "workout" | "told" | null;
  points7: number;
  daysSinceHit: number | null; // null: not in the last 30 days
  readyIn: number;
  out: string | null; // why it's out today: "sore", "after forearms"
};

export type TrainingArea = Head & {
  muscles: MuscleState[];
  groups: Record<string, number | null>; // days since each day type's muscles were last worked
  due: TrackedMuscle[];
  split: { kind: string; count: number; target: number | null }[];
  // The rule-based pick for today (Training's Next up), with illness applied.
  suggested: { name: string | null; work: { muscle: TrackedMuscle; intensity: Intensity }[]; note: string | null };
};

export type FuelDay = {
  calories: number;
  caloriesTarget: number;
  proteinG: number;
  proteinTarget: number;
  waterOz: number | null;
  waterTarget: number;
  // Added Oct 31, 2026; null when the day's meals predate tracking them.
  caffeineMg?: number | null;
  caffeineLast?: string | null; // local "HH:MM" of the latest caffeine
  caffeineLate?: boolean; // any caffeine after the cutoff
  addedSugarG?: number | null;
} | null;

export type FuelArea = Head & {
  yesterday: FuelDay;
  today: FuelDay;
  proteinStreak: number; // days in a row under 80% of the protein target, with meals logged
};

export type MoodArea = Head & {
  mood: Dated<number> | null;
  stress: Dated<number> | null;
  energy: Dated<number> | null;
  trend7: (number | null)[];
  lowStreak: number; // rated days in a row with mood 2 or under
  lastEntries: { id: string; date: string; kind: string }[];
};

export type HabitsArea = Head & {
  yesterday: { habit: string; outcome: HabitOutcome; level: number; lateMinutes: number | null }[];
  missStreaks: string[]; // habits missed on 3+ of their last 5 tracked days
};

export type CareerArea = Head & {
  workStress: Dated<number>[]; // stress on Work-tagged entries, last 3 days
  workDays7: number;
  latestTag: Dated<string> | null;
};

export type RelationshipsArea = Head & {
  recent: { tag: string; date: string; mood: number | null }[];
  social7: number;
};

export const EXPLANATION_KINDS = ["habit", "late_night", "load", "stress", "caffeine"] as const;
export type Explanation = {
  kind: (typeof EXPLANATION_KINDS)[number];
  detail: string;
  affects: ("sleep" | "resting_hr" | "hrv" | "sleep_temp" | "recovery")[];
  source: string; // the area it came from
};

export type BodyState = {
  meta: {
    date: string;
    schemaVersion: number;
    builtAt: string;
    trigger: "morning" | "checkin" | "report" | "late_data" | "rebuild" | "live"; // live: built on demand, not stored
    dataThrough: string | null;
    lastNightIn: boolean;
    missing: string[];
  };
  physical: Head & {
    sleep: SleepArea;
    recovery: RecoveryArea;
    vitals: VitalsArea;
    illness: IllnessArea;
    load: LoadArea;
    training: TrainingArea;
    fuel: FuelArea;
  };
  mental: Head & { mood: MoodArea };
  lifestyle: Head & { habits: HabitsArea; career: CareerArea; relationships: RelationshipsArea };
  explanations: Explanation[];
};

// Everything buildBodyState reads, loaded by loadBodySources. The windows
// are what the areas need: baselines take 31 days, load 28, the rest a week.
export type BodySources = {
  health: HealthDay[]; // date − 62 to date
  healthWorkouts: HealthWorkout[]; // date − 30 to date
  sessions: WorkoutSession[]; // date − 30 to date
  fitbit: FitbitWorkout[]; // date − 7 to date
  soreness: SorenessReport[]; // date − 14 to date
  illness: IllnessDay[]; // date − 60 to date
  journal: JournalEntry[]; // date − 7 to date
  habits: Habit[];
  habitLogs: HabitLog[]; // date − 10 to date
  meals: MacroEntry[]; // date − 7 to date
  water: Record<string, number>; // oz by date, yesterday and today
  goals: Goals;
  lastSync: HealthSyncRun | null;
};
