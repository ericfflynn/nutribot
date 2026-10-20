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
  // Heavy or to failure: 5-6 days.
  hard: { label: "Hard", recoveryDays: 5, points: 3 }
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
  readyIn: number; // days until recovered; 0 is ready
};

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Soreness reported on the Training tab (body_log, kind "sore"). A small
// input: it can only push back when a muscle is ready to train again (a mild
// report for the day it's made, a bad one for three days), never its weekly
// points. Report it again to extend it. First guesses; tune with history.
export const SEVERITIES = ["mild", "bad"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SORENESS_HOLD_DAYS: Record<Severity, number> = { mild: 1, bad: 3 };
export type SorenessReport = { id: string; date: string; muscle: string; severity: Severity };

// Where a muscle stands on the weekly target: covered at 4 points; otherwise
// due when it's ready to train, recovering while it isn't. The Training tab's
// body map and "This week" both use this.
export const WEEK_BUCKETS = ["due", "recovering", "covered"] as const;
export type WeekBucket = (typeof WEEK_BUCKETS)[number];

export function bucketOf(load: Load): WeekBucket {
  if (load.points >= WEEKLY_TARGET_POINTS) return "covered";
  return load.readyIn > 0 ? "recovering" : "due";
}

// How fatigued a muscle is, 0 (ready) to 1 (a hard session today), from its
// days until ready. The body map tints muscles toward red by it.
export function fatigueLevel(readyIn: number) {
  const most = INTENSITY_RULES.hard.recoveryDays;
  return Math.min(readyIn, most) / most;
}

// Days until a muscle's soreness has passed, from its latest report on or
// before today.
function sorenessReadyIn(reports: readonly SorenessReport[], muscle: TrackedMuscle, today: string) {
  let readyIn = 0;
  for (const report of reports) {
    const ago = daysBetween(report.date, today);
    if (report.muscle !== muscle || ago < 0) continue;
    readyIn = Math.max(readyIn, SORENESS_HOLD_DAYS[report.severity] - ago);
  }
  return readyIn;
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

// Weekly volume and recovery for one muscle. A session logged as the whole
// group counts for every muscle in it; soreness can only push recovery out.
export function loadOf(
  sessions: readonly TrainedSession[],
  muscle: TrackedMuscle,
  today: string,
  soreness: readonly SorenessReport[] = []
): Load {
  const hits = hitsOf(sessions, muscle, today);
  return {
    points: hits.reduce((sum, hit) => sum + hit.points, 0),
    readyIn: Math.max(0, ...hits.map((hit) => hit.readyIn), sorenessReadyIn(soreness, muscle, today))
  };
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
  const sore = soreness
    .filter((report) => report.muscle === muscle && daysBetween(report.date, today) >= 0)
    .filter((report) => SORENESS_HOLD_DAYS[report.severity] - daysBetween(report.date, today) > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  return { muscle, bucket: bucketOf(load), fatigue: fatigueLevel(load.readyIn), ...load, hits, sore };
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

// Strength days to suggest, each with the muscles it covers.
const SPLITS: { name: string; muscles: TrackedMuscle[] }[] = [
  { name: "Push day", muscles: ["Chest", "Front Delts", "Side Delts", "Triceps"] },
  { name: "Pull day", muscles: ["Lats", "Upper Back", "Traps", "Rear Delts", "Biceps"] },
  { name: "Leg day", muscles: ["Quads", "Hamstrings", "Glutes", "Calves"] }
];
// Core is added to whichever day comes next, not a day of its own.
const CORE: TrackedMuscle[] = ["Upper Abs", "Lower Abs", "Obliques"];

// Days counted for a muscle never logged, and the cap on any gap.
const NEVER_DAYS = 30;

export type NextUp = {
  // null when nothing ready is short of its weekly volume.
  split: string | null;
  // Why there's no split: every muscle at target, or the short ones still recovering.
  rest: "covered" | "recovering" | null;
  // Ready muscles furthest below the weekly target, at most 3.
  neglected: { muscle: TrackedMuscle; since: number | null; points: number }[];
  addCore: boolean; // core is ready and short of its weekly volume
};

// What to train next: the split with the most volume missing from muscles
// that have recovered and aren't sore. Longer gaps break ties. `lastByName`
// maps group and muscle names to the last date trained; `sessions` must cover
// the last week.
export function recommendNext(
  lastByName: Map<string, string>,
  sessions: readonly TrainedSession[],
  today: string,
  soreness: readonly SorenessReport[] = []
): NextUp {
  const sinceOf = (muscle: TrackedMuscle) => {
    const values = [...namesFor(muscle), groupOf(muscle)]
      .map((name) => lastByName.get(name))
      .filter((date): date is string => date != null)
      .map((date) => daysBetween(date, today));
    return values.length ? Math.min(...values) : null;
  };
  const stateOf = (muscle: TrackedMuscle) => {
    const load = loadOf(sessions, muscle, today, soreness);
    const since = sinceOf(muscle);
    const short = Math.max(0, WEEKLY_TARGET_POINTS - load.points);
    return { muscle, since, points: load.points, ready: load.readyIn === 0, short };
  };
  const scored = SPLITS.map((split) => {
    const muscles = split.muscles.map(stateOf);
    const gap = (since: number | null) => Math.min(NEVER_DAYS, since ?? NEVER_DAYS) / (NEVER_DAYS * 10);
    const score =
      muscles.reduce((sum, item) => sum + (item.ready && item.short ? item.short / WEEKLY_TARGET_POINTS + gap(item.since) : 0), 0) /
      muscles.length;
    return { split, muscles, score };
  });
  const core = CORE.map(stateOf);
  const addCore = core.some((item) => item.ready && item.short > 0);
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score === 0) {
    const anyShort = scored.some((item) => item.muscles.some((muscle) => muscle.short > 0));
    return { split: null, rest: anyShort ? "recovering" : "covered", neglected: [], addCore };
  }
  const neglected = best.muscles
    .filter((item) => item.ready && item.short > 0)
    .sort((a, b) => a.points - b.points || (b.since ?? Infinity) - (a.since ?? Infinity))
    .slice(0, 3)
    .map(({ muscle, since, points }) => ({ muscle, since, points }));
  return { split: best.split.name, rest: null, neglected, addCore };
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
