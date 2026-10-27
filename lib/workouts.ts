// Logged workouts (workout_sessions) and how they're matched to Fitbit
// workouts (health_workouts). Matching is deterministic code; the chat brain
// only supplies the clues: type, date, an optional time window.
import type { Pool } from "pg";

// Muscles are picked group first, then specific muscles. A session stores a
// mix of both: a group name means the whole group (or unspecified), a muscle
// name means just that muscle. Chest isn't split: it is one muscle. Older
// sessions use names that changed since (LEGACY_MUSCLES: Abs, Upper/Mid/Lower
// Chest); they still read, as what they cover now.
export const MUSCLE_GROUPS = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core", "Cardio", "Mobility"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLES = {
  Chest: [],
  Back: ["Lats", "Upper Back", "Traps", "Lower Back"],
  Shoulders: ["Front Delts", "Side Delts", "Rear Delts"],
  Arms: ["Biceps", "Triceps", "Forearms"],
  Legs: ["Quads", "Hamstrings", "Glutes", "Calves"],
  Core: ["Upper Abs", "Lower Abs", "Obliques"],
  Cardio: [],
  Mobility: []
} as const satisfies Record<MuscleGroup, readonly string[]>;

export type SpecificMuscle = (typeof MUSCLES)[MuscleGroup][number];
// What weekly volume and recovery are tracked on: each specific muscle, or a
// strength group that isn't split (Chest) as a whole.
export type TrackedMuscle = SpecificMuscle | "Chest";

// Names older sessions use that changed later, and what they count as now.
// Not offered for new sessions; still valid when reading or editing old ones.
export const LEGACY_MUSCLES = {
  Abs: { group: "Core", covers: ["Upper Abs", "Lower Abs"] },
  "Upper Chest": { group: "Chest", covers: ["Chest"] },
  "Mid Chest": { group: "Chest", covers: ["Chest"] },
  "Lower Chest": { group: "Chest", covers: ["Chest"] }
} as const satisfies Record<string, { group: MuscleGroup; covers: readonly TrackedMuscle[] }>;
type LegacyMuscle = keyof typeof LEGACY_MUSCLES;

// What a session's muscle_groups holds: group names and specific muscles.
export type MuscleName = MuscleGroup | SpecificMuscle | LegacyMuscle;
// The names offered for new sessions (the chat and the pickers).
export const CURRENT_MUSCLE_NAMES = [
  ...MUSCLE_GROUPS,
  ...MUSCLE_GROUPS.flatMap((group) => MUSCLES[group] as readonly SpecificMuscle[])
] as [MuscleName, ...MuscleName[]];
// Every valid stored name, legacy ones included.
export const MUSCLE_NAMES = [...CURRENT_MUSCLE_NAMES, ...(Object.keys(LEGACY_MUSCLES) as LegacyMuscle[])] as [
  MuscleName,
  ...MuscleName[]
];

// What a strength group's volume is tracked on.
export function trackedOf(group: MuscleGroup): TrackedMuscle[] {
  const muscles = MUSCLES[group] as readonly SpecificMuscle[];
  return muscles.length ? [...muscles] : [group as TrackedMuscle];
}

// The stored names that mean this muscle specifically: itself and any legacy
// name covering it.
export function namesFor(muscle: TrackedMuscle): MuscleName[] {
  const legacy = (Object.keys(LEGACY_MUSCLES) as LegacyMuscle[]).filter((name) =>
    (LEGACY_MUSCLES[name].covers as readonly string[]).includes(muscle)
  );
  return [muscle, ...legacy];
}

// The specific muscles a stored name stands for: itself, a legacy name's
// muscles, or nothing for a group (a group is handled as the whole group).
export function musclesOf(name: MuscleName): readonly TrackedMuscle[] {
  if (name in LEGACY_MUSCLES) return LEGACY_MUSCLES[name as LegacyMuscle].covers;
  return (MUSCLE_GROUPS as readonly string[]).includes(name) ? [] : [name as SpecificMuscle];
}

// An old session's names and intensities in today's terms, for editing:
// "Mid Chest" becomes Chest, "Abs" becomes Upper Abs and Lower Abs.
export function currentMuscles(names: readonly MuscleName[], intensity: MuscleIntensity) {
  const nextIntensity: MuscleIntensity = { ...intensity };
  const next = names.flatMap((name) => {
    if (!(name in LEGACY_MUSCLES)) return [name];
    const covers = LEGACY_MUSCLES[name as LegacyMuscle].covers as readonly MuscleName[];
    const level = intensity[name];
    delete nextIntensity[name];
    if (level) for (const covered of covers) nextIntensity[covered] ??= level;
    return covers;
  });
  const muscleGroups = normalizeMuscles(next);
  return { muscleGroups, muscleIntensity: cleanIntensity(nextIntensity, muscleGroups) };
}

// The strength groups: the Training tab's coverage grid and "Next up".
// Cardio and Mobility are tracked as activities instead (ACTIVITY_CATEGORIES).
export const STRENGTH_GROUPS: MuscleGroup[] = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core"];
// Every muscle volume, recovery and soreness are tracked on, in display order.
export const TRACKED_MUSCLES: TrackedMuscle[] = STRENGTH_GROUPS.flatMap(trackedOf);

// How hard each muscle was worked. A session can set it per muscle ("light
// chest, heavy tris"); a muscle without its own intensity takes the session's
// RPE. Each intensity has a recovery gap and counts toward weekly volume.
export const INTENSITIES = ["light", "medium", "hard"] as const;
export type Intensity = (typeof INTENSITIES)[number];
// Keys are names from the session's muscle_groups.
export type MuscleIntensity = Partial<Record<MuscleName, Intensity>>;

export const INTENSITY_RULES: Record<Intensity, { label: string; recoveryDays: number; points: number }> = {
  // Mostly stretching and light movement: fine the next day.
  light: { label: "Light", recoveryDays: 1, points: 1 },
  // Solid working sets: 2-3 days.
  medium: { label: "Medium", recoveryDays: 2, points: 2 },
  // Heavy or to failure: 4 days (very sore, fading; see sorenessOf).
  hard: { label: "Hard", recoveryDays: 4, points: 3 }
};
// Volume points each muscle should get in any 7 days: a hard and a light
// session, or two medium. A group's target is this times its muscles.
export const WEEKLY_TARGET_POINTS = 4;
const WEEK_DAYS = 7;

export function intensityFromRpe(rpe: number | null): Intensity {
  if (rpe == null) return "medium";
  if (rpe >= 7) return "hard";
  if (rpe >= 4) return "medium";
  return "light";
}

// A muscle's intensity in a session: its own, its group's, or the RPE's.
export function intensityOf(session: { muscleIntensity: MuscleIntensity; rpe: number | null }, name: MuscleName): Intensity {
  return session.muscleIntensity[name] ?? session.muscleIntensity[groupOf(name)] ?? intensityFromRpe(session.rpe);
}

// Keeps only intensities for names the session actually lists.
export function cleanIntensity(intensity: MuscleIntensity, names: readonly MuscleName[]): MuscleIntensity {
  return Object.fromEntries(Object.entries(intensity).filter(([name]) => names.includes(name as MuscleName)));
}

// What the recovery and volume rules need from a logged session.
export type TrainedSession = { date: string; muscleGroups: MuscleName[]; muscleIntensity: MuscleIntensity; rpe: number | null };

export type Load = {
  points: number; // volume points in the last 7 days, today included
  soreness: number; // 0 fresh to 3 very sore, fading (sorenessOf)
  readyIn: number; // days until fresh; 0 is ready
};

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Soreness: one level per muscle, 0 Fresh, 1 Slight, 2 Sore, 3 Very sore.
// Workouts set it (light 1, medium 2, hard 3, never lowering it) and it fades
// SORENESS_FADE_PER_DAY a day, so very sore is fresh again in 4 days, sore in
// 2, slight in 1. The owner can set any muscle's level from the body map
// (body_log, kind "sore", `level`): his level replaces the computed one that
// day (unless that day's workout set it higher), holds through the next and
// fades from there. So "still sore after 5
// days" holds a muscle back, and "feels fresh" makes it ready early.
export const SORENESS_LEVELS = ["Fresh", "Slight", "Sore", "Very sore"] as const;
export const SORENESS_FROM: Record<Intensity, number> = { light: 1, medium: 2, hard: 3 };
export const SORENESS_FADE_PER_DAY = 0.75;
const SORENESS_LOOKBACK_DAYS = 14;
export type SorenessReport = { id: string; date: string; muscle: string; level: number };

// The level as a step: halves round down, so 0.5 is fresh and 1.5 slight.
export function sorenessStep(level: number) {
  return level <= 0.5 ? 0 : level <= 1.5 ? 1 : level <= 2.5 ? 2 : 3;
}

// A muscle's soreness on `date`, after that day's workouts and reports.
export function sorenessOf(
  sessions: readonly TrainedSession[],
  reports: readonly SorenessReport[],
  muscle: TrackedMuscle,
  date: string
) {
  const hits = hitsOf(sessions, muscle, date).filter((hit) => hit.ago <= SORENESS_LOOKBACK_DAYS);
  const mine = reports.filter((report) => report.muscle === muscle);
  let level = 0;
  let reported = false;
  for (let ago = SORENESS_LOOKBACK_DAYS; ago >= 0; ago -= 1) {
    // A level he set holds through the next day (soreness peaks the day
    // after), then fades.
    if (!reported) level = Math.max(0, level - SORENESS_FADE_PER_DAY);
    reported = false;
    let worked = 0;
    for (const hit of hits) if (hit.ago === ago) worked = Math.max(worked, SORENESS_FROM[hit.intensity]);
    level = Math.max(level, worked);
    const day = shiftDate(date, -ago);
    const report = mine.find((item) => item.date === day);
    if (report) {
      // On a day he also trained it, the higher of the two: sore in the
      // morning and then a hard session is very sore, not just sore.
      level = Math.max(report.level, worked);
      reported = report.level >= worked;
    }
  }
  return level;
}

function readyInFor(level: number) {
  return level <= 0.5 ? 0 : Math.ceil((level - 0.5) / SORENESS_FADE_PER_DAY);
}

// Where a muscle stands on the weekly target: covered at 4 points; otherwise
// due when it's ready to train, recovering while it isn't. The Training tab's
// body map and "This week" both use this.
export const WEEK_BUCKETS = ["due", "recovering", "covered"] as const;
export type WeekBucket = (typeof WEEK_BUCKETS)[number];

export function bucketOf(load: Load): WeekBucket {
  if (load.points >= WEEKLY_TARGET_POINTS) return "covered";
  return load.readyIn > 0 ? "recovering" : "due";
}

// How sore a muscle is, 0 (fresh) to 1 (very sore). The body map tints
// muscles toward red by it.
export function fatigueLevel(soreness: number) {
  return Math.min(soreness, 3) / 3;
}

// The sessions that trained a muscle, with what each did to it.
function hitsOf<S extends TrainedSession>(sessions: readonly S[], muscle: TrackedMuscle, today: string) {
  return sessions.flatMap((session) => {
    const ago = daysBetween(session.date, today);
    const name = session.muscleGroups.find((item) => item === groupOf(muscle) || musclesOf(item).includes(muscle));
    if (ago < 0 || !name) return [];
    const intensity = intensityOf(session, name);
    const rules = INTENSITY_RULES[intensity];
    return [{ session, intensity, ago, points: ago < WEEK_DAYS ? rules.points : 0, readyIn: Math.max(0, rules.recoveryDays - ago) }];
  });
}

// Weekly volume and soreness for one muscle. A session logged as the whole
// group counts for every muscle in it.
export function loadOf(
  sessions: readonly TrainedSession[],
  muscle: TrackedMuscle,
  today: string,
  soreness: readonly SorenessReport[] = []
): Load {
  const hits = hitsOf(sessions, muscle, today);
  const level = sorenessOf(sessions, soreness, muscle, today);
  // A level he set today holds through tomorrow: a day more to fresh.
  const held = level > 0.5 && soreness.some((report) => report.muscle === muscle && report.date === today);
  return { points: hits.reduce((sum, hit) => sum + hit.points, 0), soreness: level, readyIn: readyInFor(level) + (held ? 1 : 0) };
}

// Everything the body map says about one muscle: its bucket and why.
export function muscleWeekOf<S extends TrainedSession>(
  sessions: readonly S[],
  soreness: readonly SorenessReport[],
  muscle: TrackedMuscle,
  today: string
) {
  const load = loadOf(sessions, muscle, today, soreness);
  const hits = hitsOf(sessions, muscle, today)
    .filter((hit) => hit.ago < WEEK_DAYS || hit.readyIn > 0)
    .sort((a, b) => a.ago - b.ago);
  // The owner's own level for today, if he set one.
  const todayReport = soreness.find((report) => report.muscle === muscle && report.date === today) ?? null;
  return { muscle, bucket: bucketOf(load), fatigue: fatigueLevel(load.soreness), ...load, hits, todayReport };
}

// How much of a group one day's sessions worked, for the coverage grid's group
// row: each muscle's points (the hardest that day; a whole-group session counts
// for all of them), averaged over the group's muscles and rounded back to an
// intensity. One medium Side Delts set is a light day for Shoulders; the whole
// group at medium is medium. Undefined when nothing in the group was trained.
export function groupDayIntensity(daySessions: readonly TrainedSession[], group: MuscleGroup): Intensity | undefined {
  const muscles = trackedOf(group);
  let total = 0;
  for (const muscle of muscles) {
    let best = 0;
    for (const session of daySessions) {
      const name = session.muscleGroups.find((item) => item === group || musclesOf(item).includes(muscle));
      if (name) best = Math.max(best, INTENSITY_RULES[intensityOf(session, name)].points);
    }
    total += best;
  }
  if (!total) return undefined;
  const average = total / muscles.length;
  return [...INTENSITIES].reverse().find((intensity) => average >= INTENSITY_RULES[intensity].points - 0.5) ?? "light";
}

export type MuscleStatus = { muscle: TrackedMuscle; group: MuscleGroup } & Load;

// Every strength muscle sorted into what to train: due (recovered and short
// of the weekly target, least volume first), recovering (short but not ready,
// soonest first) and covered (at target).
export function weekStatus(sessions: readonly TrainedSession[], today: string, soreness: readonly SorenessReport[] = []) {
  const all: MuscleStatus[] = STRENGTH_GROUPS.flatMap((group) =>
    trackedOf(group).map((muscle) => ({ muscle, group, ...loadOf(sessions, muscle, today, soreness) }))
  );
  return {
    due: all.filter((item) => bucketOf(item) === "due").sort((a, b) => a.points - b.points),
    recovering: all.filter((item) => bucketOf(item) === "recovering").sort((a, b) => a.readyIn - b.readyIn),
    covered: all.filter((item) => bucketOf(item) === "covered")
  };
}

// The higher-level mix: what kind of training each workout was.
export const ACTIVITY_CATEGORIES = ["strength", "cardio", "mobility", "sport"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number] | "other";
export const ACTIVITY_LABELS: Record<ActivityCategory, string> = {
  strength: "Strength",
  cardio: "Cardio",
  mobility: "Mobility",
  sport: "Sport",
  other: "Other"
};

export function activityCategoryOf(type: WorkoutType): ActivityCategory {
  if (type === "strength") return "strength";
  if (type === "run" || type === "walk" || type === "ride" || type === "class") return "cardio";
  if (type === "pilates" || type === "yoga") return "mobility";
  if (type === "sport") return "sport";
  return "other";
}

// Every kind of training a workout was, its main one first. The muscles can
// say more than the type: only Mobility is a mobility session (stretching has
// no type of its own), only Cardio is cardio, and Mobility or Cardio inside
// another workout counts for that kind too. An "other" workout with strength
// muscles is strength.
export function activityCategoriesOf(type: WorkoutType, muscles: readonly MuscleName[] = []): ActivityCategory[] {
  const kinds = new Set(muscles.map((name) => (name === "Mobility" ? "mobility" : name === "Cardio" ? "cardio" : "strength")));
  const byType = activityCategoryOf(type);
  const main: ActivityCategory =
    kinds.size && !kinds.has("strength") && !kinds.has(byType as never)
      ? kinds.has("mobility")
        ? "mobility"
        : "cardio"
      : byType === "other" && kinds.has("strength")
        ? "strength"
        : byType;
  const extra = (["mobility", "cardio"] as const).filter((kind) => kinds.has(kind) && kind !== main);
  return [main, ...extra];
}

// A good week's split: sessions of each kind in any 7 days. Sport counts but
// has no target. A workout counts for every kind it includes, so stretching
// logged on a strength session is also a mobility session.
export const SPLIT_TARGETS: Partial<Record<ActivityCategory, number>> = { strength: 4, cardio: 2, mobility: 2 };
export const SPLIT_KINDS = ["strength", "cardio", "mobility", "sport"] as const;

export type SplitEntry = { kind: (typeof SPLIT_KINDS)[number]; count: number; target: number | null };

// Each kind's sessions against its target, from each workout's kinds
// (activityCategoriesOf).
export function splitOf(workouts: readonly (readonly ActivityCategory[])[]): SplitEntry[] {
  return SPLIT_KINDS.map((kind) => ({
    kind,
    count: workouts.filter((kinds) => kinds.includes(kind)).length,
    target: SPLIT_TARGETS[kind] ?? null
  }));
}

// Next up: what to train next, from each muscle's soreness and last hit. Not
// a strict push/pull/legs split: arm and shoulder days are in the mix, and
// whatever was logged simply moves each muscle's last hit.
const DAY_TYPES: { name: string; muscles: TrackedMuscle[] }[] = [
  { name: "Push day", muscles: ["Chest", "Front Delts", "Side Delts", "Triceps"] },
  { name: "Pull day", muscles: ["Lats", "Upper Back", "Traps", "Rear Delts", "Biceps", "Forearms"] },
  { name: "Leg day", muscles: ["Quads", "Hamstrings", "Glutes", "Calves", "Lower Back"] },
  { name: "Arm day", muscles: ["Biceps", "Triceps", "Forearms"] },
  { name: "Shoulder day", muscles: ["Front Delts", "Side Delts", "Rear Delts", "Traps"] }
];
// Core is added to a day when it's due, not a day of its own.
const CORE: TrackedMuscle[] = ["Upper Abs", "Lower Abs", "Obliques"];

// A muscle is due once it's fresh and this many days have passed since its
// last medium or hard work. Any soreness, even slight, keeps it out, the same
// as the body map's "recovering". Every muscle should be hit within 7.
export const DUE_AFTER_DAYS = 4;
const MIN_DUE = 2; // a day needs at least this many due muscles
const MAX_ACCESSORY = 2;
// The day types "after that" lists; arm and shoulder days are only picks.
const MAIN_DAYS = ["Push day", "Pull day", "Leg day"];
const NEVER = 99;

// Rules the plan follows. Each can only lower a day's intensity. They're
// data, not code, so they can move to the database and be added from chat;
// new kinds of rule are code.
//   after_hard: after a hard day on any of these muscles, the next day's work
//     on any of them is at most maxNext ("heavy bench, then back light").
//   hard_streak: at most maxDays hard strength days in a row.
//   not_after: the day after any work on `after`, `skip` isn't trained at all
//     ("no back the day after forearms": grip needs a day). Next up lists
//     those muscles as out, tagged with `tag`.
export type TrainingRule =
  | { id: string; kind: "after_hard"; label: string; muscles: TrackedMuscle[]; maxNext: Intensity }
  | { id: string; kind: "hard_streak"; label: string; maxDays: number }
  | { id: string; kind: "not_after"; label: string; tag: string; after: TrackedMuscle[]; skip: TrackedMuscle[] };

export const DEFAULT_RULES: TrainingRule[] = [
  {
    id: "shoulder-joint",
    kind: "after_hard",
    label: "Easy on the shoulder the day after a heavy upper-body day",
    muscles: ["Chest", "Front Delts", "Side Delts", "Rear Delts", "Triceps", "Lats", "Upper Back"],
    maxNext: "medium"
  },
  { id: "hard-streak", kind: "hard_streak", label: "At most 2 hard days in a row", maxDays: 2 },
  {
    id: "grip",
    kind: "not_after",
    label: "No back the day after forearms",
    tag: "after forearms",
    after: ["Forearms"],
    skip: ["Lats", "Upper Back", "Traps"]
  },
  {
    id: "biceps-before-back",
    kind: "not_after",
    label: "No back the day after biceps",
    tag: "after biceps",
    after: ["Biceps"],
    skip: ["Lats", "Upper Back", "Traps"]
  },
  {
    id: "triceps-before-chest",
    kind: "not_after",
    label: "No chest the day after triceps",
    tag: "after triceps",
    after: ["Triceps"],
    skip: ["Chest"]
  }
];

const RANK: Record<Intensity, number> = { light: 0, medium: 1, hard: 2 };

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// The hardest each tracked muscle was worked on one date.
function intensitiesOn(sessions: readonly TrainedSession[], date: string) {
  const byMuscle = new Map<TrackedMuscle, Intensity>();
  for (const session of sessions) {
    if (session.date !== date) continue;
    for (const name of session.muscleGroups) {
      const intensity = intensityOf(session, name);
      // A group name means every muscle in it.
      const muscles = (MUSCLE_GROUPS as readonly string[]).includes(name) ? trackedOf(name as MuscleGroup) : musclesOf(name);
      for (const muscle of muscles) {
        const before = byMuscle.get(muscle);
        if (!before || RANK[intensity] > RANK[before]) byMuscle.set(muscle, intensity);
      }
    }
  }
  return byMuscle;
}

const hasHard = (byMuscle: Map<TrackedMuscle, Intensity>, muscles: readonly TrackedMuscle[] = TRACKED_MUSCLES) =>
  muscles.some((muscle) => byMuscle.get(muscle) === "hard");

// The most the rules allow a day on these muscles, and the rule that set it.
function ruleCap(sessions: readonly TrainedSession[], date: string, muscles: readonly TrackedMuscle[], rules: readonly TrainingRule[]) {
  let cap: { max: Intensity; rule: TrainingRule | null } = { max: "hard", rule: null };
  const lower = (max: Intensity, rule: TrainingRule) => {
    if (RANK[max] < RANK[cap.max]) cap = { max, rule };
  };
  const yesterday = intensitiesOn(sessions, shiftDate(date, -1));
  for (const rule of rules) {
    if (rule.kind === "after_hard") {
      if (hasHard(yesterday, rule.muscles) && muscles.some((muscle) => rule.muscles.includes(muscle))) lower(rule.maxNext, rule);
    } else if (rule.kind === "hard_streak") {
      let streak = 0;
      while (streak < rule.maxDays && hasHard(intensitiesOn(sessions, shiftDate(date, -(streak + 1))))) streak += 1;
      if (streak >= rule.maxDays) lower("medium", rule);
    }
  }
  return cap;
}

// Muscles the not_after rules keep out on `date`, with the rule for each.
function skippedOn(sessions: readonly TrainedSession[], date: string, rules: readonly TrainingRule[]) {
  const yesterday = intensitiesOn(sessions, shiftDate(date, -1));
  const skipped = new Map<TrackedMuscle, TrainingRule>();
  for (const rule of rules) {
    if (rule.kind !== "not_after" || !rule.after.some((muscle) => yesterday.has(muscle))) continue;
    for (const muscle of rule.skip) if (!skipped.has(muscle)) skipped.set(muscle, rule);
  }
  return skipped;
}

// Days since a muscle's last medium or hard work before `date`, and whether
// that included a hard day in the last 7. NEVER when not in the sessions.
function lastHitOf(sessions: readonly TrainedSession[], muscle: TrackedMuscle, date: string) {
  let since = NEVER;
  let hardThisWeek = false;
  for (const hit of hitsOf(sessions, muscle, date)) {
    if (hit.ago < 1 || hit.intensity === "light") continue;
    since = Math.min(since, hit.ago);
    if (hit.intensity === "hard" && hit.ago < WEEK_DAYS) hardThisWeek = true;
  }
  return { since, hardThisWeek };
}

const isStrength = (session: TrainedSession) =>
  session.muscleGroups.some((name) => STRENGTH_GROUPS.includes(groupOf(name)));

export type SuggestedDay = {
  name: string; // the day type
  // Its fresh, due muscles (and core when due), each at the most the week
  // and the rules allow.
  work: { muscle: TrackedMuscle; intensity: Intensity; since: number }[];
  // Its muscles that are sore: light blood-flow work only.
  bloodFlow: TrackedMuscle[];
  // A light finisher or two outside the day: fresh, due muscles.
  accessory: TrackedMuscle[];
  heldBy: TrainingRule | null; // a rule that kept some of it below hard
};

export type Suggestion = {
  date: string;
  // Muscles with any soreness (slight or more), sorest first, then fresh ones
  // a not_after rule keeps out (`because` is its tag).
  out: { muscle: TrackedMuscle; level: number; because: string | null }[];
  // Fresh muscles, longest since a real hit first.
  fresh: { muscle: TrackedMuscle; level: number; since: number }[];
  pick: SuggestedDay | null; // null: nothing due, a rest or active-recovery day
  alternatives: string[]; // other day types with enough due, at most 2
  // The main day types after the pick, in the order they'll be due.
  after: string[];
};

// What to train on `date`, the way the owner decides: what's out (sore),
// what's fresh and due (DUE_AFTER_DAYS since a real hit), and the day type
// whose due muscles are most overdue. No dates ahead: a missed day just leaves the
// same suggestion up. Pass the sessions up to the day before `date`.
export function suggestNext(
  sessions: readonly TrainedSession[],
  date: string,
  soreness: readonly SorenessReport[] = [],
  rules: readonly TrainingRule[] = DEFAULT_RULES
): Suggestion {
  const state = new Map(
    TRACKED_MUSCLES.map((muscle) => {
      const level = sorenessOf(sessions, soreness, muscle, date);
      return [muscle, { muscle, level, ...lastHitOf(sessions, muscle, date) }] as const;
    })
  );
  const skipped = skippedOn(sessions, date, rules);
  const isReady = (muscle: TrackedMuscle) => {
    const item = state.get(muscle)!;
    return sorenessStep(item.level) === 0 && item.since >= DUE_AFTER_DAYS;
  };
  const isDue = (muscle: TrackedMuscle) => isReady(muscle) && !skipped.has(muscle);
  const options = DAY_TYPES.map((type) => {
    const due = type.muscles.filter(isDue);
    // How overdue: each due muscle's days past DUE_AFTER_DAYS (capped), so
    // four muscles at 8 days beat six at 4.
    const overdue = due.reduce((sum, muscle) => sum + Math.min(state.get(muscle)!.since, 14) - DUE_AFTER_DAYS + 1, 0);
    return { type, due, overdue };
  })
    .filter((option) => option.due.length >= MIN_DUE)
    .sort((a, b) => b.overdue - a.overdue || b.due.length - a.due.length);

  let pick: SuggestedDay | null = null;
  const best = options[0];
  if (best) {
    const core = CORE.filter(isDue);
    const muscles = [...best.due, ...(core.length >= MIN_DUE ? core : [])];
    const cap = ruleCap(sessions, date, muscles, rules);
    let heldBy: TrainingRule | null = null;
    const work = muscles.map((muscle) => {
      const item = state.get(muscle)!;
      let intensity: Intensity = "hard";
      // At most one hard day per muscle a week.
      if (intensity === "hard" && item.hardThisWeek) intensity = "medium";
      if (RANK[cap.max] < RANK[intensity]) {
        intensity = cap.max;
        heldBy = cap.rule;
      }
      return { muscle, intensity, since: item.since };
    });
    const accessory = TRACKED_MUSCLES.filter((muscle) => !best.type.muscles.includes(muscle) && !CORE.includes(muscle) && isDue(muscle))
      .sort((a, b) => state.get(b)!.since - state.get(a)!.since)
      .slice(0, MAX_ACCESSORY);
    const bloodFlow = best.type.muscles.filter((muscle) => sorenessStep(state.get(muscle)!.level) >= 1);
    pick = { name: best.type.name, work, bloodFlow, accessory, heldBy };
  }

  // When each main day type will next have MIN_DUE due muscles, if nothing
  // else is trained: soreness fades, days since grow.
  const dueIn = (type: (typeof DAY_TYPES)[number]) => {
    for (let wait = 0; wait <= 14; wait += 1) {
      const due = type.muscles.filter((muscle) => {
        const item = state.get(muscle)!;
        if (wait === 0 && skipped.has(muscle)) return false;
        return sorenessStep(Math.max(0, item.level - SORENESS_FADE_PER_DAY * wait)) === 0 && item.since + wait >= DUE_AFTER_DAYS;
      });
      if (due.length >= MIN_DUE) return wait;
    }
    return 15;
  };
  const after = DAY_TYPES.filter((type) => MAIN_DAYS.includes(type.name) && type.name !== pick?.name)
    .map((type) => ({ name: type.name, wait: dueIn(type) }))
    .sort((a, b) => a.wait - b.wait)
    .map((item) => item.name);

  const all = [...state.values()];
  const isSore = (item: (typeof all)[number]) => sorenessStep(item.level) >= 1;
  const ruledOut = (item: (typeof all)[number]) => !isSore(item) && skipped.has(item.muscle);
  return {
    date,
    out: [
      ...all
        .filter(isSore)
        .sort((a, b) => b.level - a.level)
        .map(({ muscle, level }) => ({ muscle, level, because: null })),
      ...all.filter(ruledOut).map(({ muscle, level }) => {
        const rule = skipped.get(muscle)!;
        return { muscle, level, because: rule.kind === "not_after" ? rule.tag : rule.label };
      })
    ],
    fresh: all
      .filter((item) => !isSore(item) && !ruledOut(item))
      .sort((a, b) => b.since - a.since)
      .map(({ muscle, level, since }) => ({ muscle, level, since })),
    pick,
    alternatives: options.slice(1, 3).map((option) => option.type.name),
    after
  };
}

export function groupOf(name: MuscleName): MuscleGroup {
  if ((MUSCLE_GROUPS as readonly string[]).includes(name)) return name as MuscleGroup;
  if (name in LEGACY_MUSCLES) return LEGACY_MUSCLES[name as LegacyMuscle].group;
  return MUSCLE_GROUPS.find((group) => (MUSCLES[group] as readonly string[]).includes(name))!;
}

// The groups a session trained, each once, in display order.
export function groupsOf(names: readonly MuscleName[]): MuscleGroup[] {
  const groups = new Set(names.map(groupOf));
  return MUSCLE_GROUPS.filter((group) => groups.has(group));
}

// One entry per muscle, and a group dropped when its own muscles are listed
// (the muscles are the more precise answer).
export function normalizeMuscles(names: readonly MuscleName[]): MuscleName[] {
  const unique = [...new Set(names)];
  return unique.filter(
    (name) => !(MUSCLE_GROUPS as readonly string[]).includes(name) || !unique.some((other) => other !== name && groupOf(other) === name)
  );
}

// Chips for a session: "Shoulders: Side Delts, Rear Delts", or "Legs" for the
// whole group. Muscles with their own intensity say so: "Chest (light)".
export function describeMuscles(names: readonly MuscleName[], intensity: MuscleIntensity = {}): string[] {
  const tag = (name: MuscleName) => (intensity[name] ? ` (${intensity[name]})` : "");
  return groupsOf(names).map((group) => {
    const specific = names.filter((name) => name !== group && groupOf(name) === group);
    return specific.length && !names.includes(group)
      ? `${group}: ${specific.map((name) => `${name}${tag(name)}`).join(", ")}`
      : `${group}${tag(group)}`;
  });
}

export const WORKOUT_TYPES = ["strength", "run", "walk", "ride", "sport", "class", "pilates", "yoga", "other"] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export const WORKOUT_TYPE_LABELS: Record<WorkoutType, string> = {
  strength: "Strength",
  run: "Run",
  walk: "Walk",
  ride: "Ride",
  sport: "Sport",
  class: "Class",
  pilates: "Pilates",
  yoga: "Yoga",
  other: "Other"
};

// Fitbit exercise types each logged type can match. "other" matches anything
// except walks, which are mostly auto-detected.
const FITBIT_TYPES: Record<Exclude<WorkoutType, "other">, string[]> = {
  strength: ["WEIGHTLIFTING", "WEIGHTS", "CORE_TRAINING", "AEROBIC_WORKOUT"],
  run: ["RUNNING", "TREADMILL"],
  walk: ["WALKING", "HIKING"],
  ride: ["BIKING", "SPINNING"],
  sport: ["TENNIS", "GOLF", "SPORT"],
  class: ["AEROBIC_WORKOUT", "PILATES", "YOGA"],
  pilates: ["PILATES"],
  yoga: ["YOGA"]
};

// The logged type a Fitbit exercise type most likely is, for unlabeled
// workouts in filters and analytics.
export function workoutTypeOf(fitbitType: string): WorkoutType {
  if (fitbitType === "PILATES") return "pilates";
  if (fitbitType === "YOGA") return "yoga";
  const found = (Object.keys(FITBIT_TYPES) as Exclude<WorkoutType, "other">[]).find((type) =>
    FITBIT_TYPES[type].includes(fitbitType)
  );
  return found ?? "other";
}

// Watch workouts the Unlabeled card asks about: their name doesn't say what
// was trained (core training and aerobics are often stretching or mobility).
// Runs, rides, yoga and the like can still be labeled from Recent workouts;
// walks are mostly auto-detected and never asked about.
const ASK_ABOUT_TYPES = new Set(["WEIGHTLIFTING", "WEIGHTS", "CORE_TRAINING", "AEROBIC_WORKOUT"]);

export function canLabel(fitbitType: string) {
  return fitbitType !== "WALKING";
}

export function fitsType(workoutType: WorkoutType, fitbitType: string) {
  if (workoutType === "other") return fitbitType !== "WALKING";
  return FITBIT_TYPES[workoutType].includes(fitbitType);
}

export type FitbitWorkout = {
  id: string;
  day: string;
  startedAt: string; // local "YYYY-MM-DDTHH:MM"
  endedAt: string;
  type: string;
  name: string;
  activeMinutes: number | null;
  avgHr: number | null;
  calories: number | null;
  sessionId: string | null; // the workout_session already linked to it
  ignored: boolean; // the owner chose to ignore it (workout_ignores)
  // Duplicate recordings folded into this one (lib/health/dedupe.ts).
  mergedIds: string[];
};

export type TimeHint = { start: string; end: string }; // local "HH:MM"

export type MatchQuery = {
  date: string;
  workoutType: WorkoutType;
  timeHint: TimeHint | null;
  // Local "YYYY-MM-DDTHH:MM" when the user wrote about it.
  loggedAt: string;
  // Fitbit ids already claimed by other drafts in the same reply.
  exclude?: string[];
};

export type MatchResult = {
  status: "matched" | "ambiguous" | "none";
  match: FitbitWorkout | null;
  // Every other fitting candidate that day, for the "Change" picker.
  alternatives: FitbitWorkout[];
};

const SLACK_MINUTES = 15;

function minutesOf(localDateTime: string) {
  const [hours, minutes] = localDateTime.slice(11, 16).split(":").map(Number);
  return hours * 60 + minutes;
}

function hhmmMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function overlaps(workout: FitbitWorkout, hint: TimeHint) {
  const start = minutesOf(workout.startedAt);
  const end = workout.endedAt.slice(0, 10) === workout.day ? minutesOf(workout.endedAt) : 24 * 60;
  return start <= hhmmMinutes(hint.end) + SLACK_MINUTES && end >= hhmmMinutes(hint.start) - SLACK_MINUTES;
}

// Picks the Fitbit workout a logged session most likely refers to.
// - Only unlinked workouts of a fitting type on that date are candidates.
// - A time hint narrows to workouts overlapping the window.
// - Same-day logs without a hint prefer the latest workout that had ended by
//   the time of the message ("just did chest" means the one that just ended).
// - One candidate left is a match; several is "ambiguous" with a best guess.
export function chooseMatch(query: MatchQuery, workouts: FitbitWorkout[]): MatchResult {
  const exclude = new Set(query.exclude ?? []);
  const fitting = workouts
    .filter((w) => w.day === query.date && !w.sessionId && !w.ignored && !exclude.has(w.id) && fitsType(query.workoutType, w.type))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!fitting.length) {
    return { status: "none", match: null, alternatives: [] };
  }

  let pool = fitting;
  if (query.timeHint) {
    const inWindow = fitting.filter((w) => overlaps(w, query.timeHint!));
    if (inWindow.length) pool = inWindow;
  } else if (query.loggedAt.slice(0, 10) === query.date) {
    // Latest to finish first: "just did chest" is the one that just ended.
    const ended = fitting
      .filter((w) => w.endedAt <= addMinutes(query.loggedAt, SLACK_MINUTES))
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt));
    if (ended.length) pool = ended;
  }

  const match = pool[0];
  return {
    status: pool.length === 1 ? "matched" : "ambiguous",
    match,
    alternatives: fitting.filter((w) => w.id !== match.id)
  };
}

function addMinutes(localDateTime: string, minutes: number) {
  const date = new Date(`${localDateTime}:00Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
}

export async function listFitbitWorkouts(
  db: Pick<Pool, "query">,
  userName: string,
  startDate: string,
  endDate: string
): Promise<FitbitWorkout[]> {
  const { rows } = await db.query(
    `
    select
      w.id as "id",
      w.day::text as "day",
      to_char(w.started_at, 'YYYY-MM-DD"T"HH24:MI') as "startedAt",
      to_char(w.ended_at, 'YYYY-MM-DD"T"HH24:MI') as "endedAt",
      w.type as "type",
      coalesce(w.name, w.type) as "name",
      w.active_minutes::int as "activeMinutes",
      w.avg_hr::int as "avgHr",
      w.calories::int as "calories",
      s.id::text as "sessionId",
      w.merged_ids as "mergedIds",
      i.health_record_key is not null as "ignored"
    from public.health_workouts w
    left join public.workout_sessions s
      on s.user_name = w.user_name and s.health_record_key = w.id
    left join public.workout_ignores i
      on i.user_name = w.user_name and i.health_record_key = w.id
    where w.user_name = $1 and w.day >= $2::date and w.day <= $3::date
    order by w.started_at desc
    `,
    [userName, startDate, endDate]
  );
  return rows;
}

// Strength workouts from the watch that nothing has been logged for.
export async function listUnlabeledWorkouts(db: Pool, userName: string, startDate: string, endDate: string) {
  const workouts = await listFitbitWorkouts(db, userName, startDate, endDate);
  return workouts.filter((w) => !w.sessionId && !w.ignored && ASK_ABOUT_TYPES.has(w.type));
}

// Ignore a watch workout nothing is logged for, or stop ignoring one.
export async function setWorkoutIgnored(db: Pick<Pool, "query">, userName: string, healthRecordKey: string, ignored: boolean) {
  if (ignored) {
    await db.query(
      `insert into public.workout_ignores (user_name, health_record_key) values ($1, $2) on conflict do nothing`,
      [userName, healthRecordKey]
    );
  } else {
    await db.query(`delete from public.workout_ignores where user_name = $1 and health_record_key = $2`, [userName, healthRecordKey]);
  }
}

export type WorkoutSessionInput = {
  date: string;
  rawText: string;
  name: string;
  workoutType: WorkoutType;
  muscleGroups: MuscleName[];
  muscleIntensity: MuscleIntensity;
  rpe: number | null;
  durationMin: number | null;
  notes: string;
  timeHint: TimeHint | null;
  untracked: boolean;
  healthRecordKey: string | null;
  linkedBy: "auto" | "user" | null;
};

export async function saveWorkoutSession(db: Pick<Pool, "query">, userName: string, input: WorkoutSessionInput) {
  const status = input.untracked ? "untracked" : input.healthRecordKey ? "linked" : "pending";
  const { rows } = await db.query<{ id: string }>(
    `
    insert into public.workout_sessions (
      user_name, entry_date, name, workout_type, muscle_groups, rpe, duration_min,
      match_status, health_record_key, linked_by, time_hint_start, time_hint_end, raw_text, notes,
      muscle_intensity
    )
    values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::time, $12::time, $13, $14, $15::jsonb)
    returning id::text
    `,
    [
      userName,
      input.date,
      input.name,
      input.workoutType,
      input.muscleGroups,
      input.rpe,
      input.durationMin,
      status,
      status === "linked" ? input.healthRecordKey : null,
      status === "linked" ? input.linkedBy : null,
      input.timeHint?.start ?? null,
      input.timeHint?.end ?? null,
      input.rawText,
      input.notes || null,
      JSON.stringify(cleanIntensity(input.muscleIntensity, input.muscleGroups))
    ]
  );
  return rows[0].id;
}

// Runs after each health sync: links pending sessions to a newly arrived
// Fitbit workout, but only when exactly one candidate fits. Ambiguous
// sessions stay pending for the owner to pick.
export async function autoLinkPendingSessions(db: Pool, userName: string) {
  const { rows: pending } = await db.query<{
    id: string;
    date: string;
    workoutType: WorkoutType;
    hintStart: string | null;
    hintEnd: string | null;
    loggedAt: string;
  }>(
    `
    select
      id::text as "id",
      entry_date::text as "date",
      workout_type as "workoutType",
      to_char(time_hint_start, 'HH24:MI') as "hintStart",
      to_char(time_hint_end, 'HH24:MI') as "hintEnd",
      to_char(created_at at time zone $2, 'YYYY-MM-DD"T"HH24:MI') as "loggedAt"
    from public.workout_sessions
    where user_name = $1 and match_status = 'pending'
    order by created_at
    `,
    [userName, process.env.APP_TIME_ZONE || "America/New_York"]
  );

  let linked = 0;
  for (const session of pending) {
    const workouts = await listFitbitWorkouts(db, userName, session.date, session.date);
    const result = chooseMatch(
      {
        date: session.date,
        workoutType: session.workoutType,
        timeHint: session.hintStart && session.hintEnd ? { start: session.hintStart, end: session.hintEnd } : null,
        loggedAt: session.loggedAt
      },
      workouts
    );
    if (result.status !== "matched" || !result.match) continue;
    const { rowCount } = await db.query(
      `
      update public.workout_sessions
      set match_status = 'linked', health_record_key = $3, linked_by = 'auto'
      where id = $1 and user_name = $2 and match_status = 'pending'
        and not exists (
          select 1 from public.workout_sessions
          where user_name = $2 and health_record_key = $3
        )
      `,
      [session.id, userName, result.match.id]
    );
    linked += rowCount ?? 0;
  }
  return linked;
}

export type WorkoutSession = {
  id: string;
  date: string;
  name: string;
  workoutType: WorkoutType;
  muscleGroups: MuscleName[];
  muscleIntensity: MuscleIntensity;
  rpe: number | null;
  durationMin: number | null;
  matchStatus: "linked" | "pending" | "untracked";
  healthRecordKey: string | null;
  notes: string | null;
};

export async function listWorkoutSessions(
  db: Pick<Pool, "query">,
  userName: string,
  startDate: string,
  endDate: string
): Promise<WorkoutSession[]> {
  const { rows } = await db.query(
    `
    select
      id::text as "id",
      entry_date::text as "date",
      name as "name",
      workout_type as "workoutType",
      muscle_groups as "muscleGroups",
      muscle_intensity as "muscleIntensity",
      rpe::float8 as "rpe",
      duration_min as "durationMin",
      match_status as "matchStatus",
      health_record_key as "healthRecordKey",
      notes as "notes"
    from public.workout_sessions
    where user_name = $1 and entry_date >= $2::date and entry_date <= $3::date
    order by entry_date desc, created_at desc
    `,
    [userName, startDate, endDate]
  );
  return rows;
}

// Unlabeled runs and rides still count as Cardio; walks don't.
export const CARDIO_FITBIT_TYPES = ["RUNNING", "TREADMILL", "BIKING", "SPINNING"];

// The last date each group or muscle name was logged, on or before endDate,
// over the past year, from logged sessions.
export async function lastTrainedByName(db: Pick<Pool, "query">, userName: string, endDate: string) {
  const { rows } = await db.query<{ name: string; day: string }>(
    `
    select trained.muscle as name, max(s.entry_date)::text as "day"
    from public.workout_sessions s, unnest(s.muscle_groups) as trained(muscle)
    where s.user_name = $1 and s.entry_date <= $2::date and s.entry_date > $2::date - 365
    group by trained.muscle
    `,
    [userName, endDate]
  );
  return new Map(rows.map((row) => [row.name, row.day]));
}

// The last date each group was trained: a muscle counts for its group.
export function lastByGroup(lastByName: Map<string, string>) {
  const byGroup = new Map<MuscleGroup, string>();
  for (const [name, day] of lastByName) {
    const group = groupOf(name as MuscleName);
    if (group && (byGroup.get(group) ?? "") < day) byGroup.set(group, day);
  }
  return byGroup;
}

export async function updateWorkoutSession(
  db: Pick<Pool, "query">,
  userName: string,
  id: string,
  changes: { name: string; workoutType: WorkoutType; muscleGroups: MuscleName[]; muscleIntensity: MuscleIntensity; rpe: number | null }
) {
  const { rowCount } = await db.query(
    `
    update public.workout_sessions
    set name = $3, muscle_groups = $4, rpe = $5, muscle_intensity = $6::jsonb, workout_type = $7
    where id = $1 and user_name = $2
    `,
    [
      id,
      userName,
      changes.name,
      changes.muscleGroups,
      changes.rpe,
      JSON.stringify(cleanIntensity(changes.muscleIntensity, changes.muscleGroups)),
      changes.workoutType
    ]
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteWorkoutSession(db: Pick<Pool, "query">, userName: string, id: string) {
  const { rowCount } = await db.query(`delete from public.workout_sessions where id = $1 and user_name = $2`, [
    id,
    userName
  ]);
  return (rowCount ?? 0) > 0;
}
