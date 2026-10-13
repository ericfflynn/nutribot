// Logged workouts (workout_sessions) and how they're matched to Fitbit
// workouts (health_workouts). Matching is deterministic code; the chat brain
// only supplies the clues: type, date, an optional time window.
import type { Pool } from "pg";

// Muscles are picked group first, then specific muscles. A session stores a
// mix of both: a group name means the whole group (or unspecified), a muscle
// name means just that muscle. Older sessions stored "Biceps", "Triceps" and
// "Abs" as groups; they are muscles of Arms and Core now, so they still read
// the same way.
export const MUSCLE_GROUPS = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core", "Cardio", "Mobility"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLES = {
  Chest: ["Upper Chest", "Mid Chest", "Lower Chest"],
  Back: ["Lats", "Upper Back", "Lower Back"],
  Shoulders: ["Front Delts", "Side Delts", "Rear Delts", "Traps"],
  Arms: ["Biceps", "Triceps", "Forearms"],
  Legs: ["Quads", "Hamstrings", "Glutes", "Calves", "Adductors"],
  Core: ["Abs", "Obliques"],
  Cardio: [],
  Mobility: []
} as const satisfies Record<MuscleGroup, readonly string[]>;

export type SpecificMuscle = (typeof MUSCLES)[MuscleGroup][number];
// What a session's muscle_groups holds: group names and specific muscles.
export type MuscleName = MuscleGroup | SpecificMuscle;
export const MUSCLE_NAMES = [
  ...MUSCLE_GROUPS,
  ...MUSCLE_GROUPS.flatMap((group) => MUSCLES[group] as readonly SpecificMuscle[])
] as [MuscleName, ...MuscleName[]];

// Groups whose gaps the Training tab calls out; Mobility is optional work.
export const TRACKED_GROUPS: MuscleGroup[] = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core", "Cardio"];

export function groupOf(name: MuscleName): MuscleGroup {
  if ((MUSCLE_GROUPS as readonly string[]).includes(name)) return name as MuscleGroup;
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

// Chips for a session: "Shoulders: Side Delts, Rear Delts", or "Legs" for the whole group.
export function describeMuscles(names: readonly MuscleName[]): string[] {
  return groupsOf(names).map((group) => {
    const specific = names.filter((name) => name !== group && groupOf(name) === group);
    return specific.length && !names.includes(group) ? `${group}: ${specific.join(", ")}` : group;
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

// Only strength workouts are worth labeling when nothing is logged for them:
// runs, rides and classes say what they were already.
export const STRENGTH_FITBIT_TYPES = ["WEIGHTLIFTING", "WEIGHTS"];
const LABELABLE_TYPES = new Set(STRENGTH_FITBIT_TYPES);

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
    .filter((w) => w.day === query.date && !w.sessionId && !exclude.has(w.id) && fitsType(query.workoutType, w.type))
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
      w.merged_ids as "mergedIds"
    from public.health_workouts w
    left join public.workout_sessions s
      on s.user_name = w.user_name and s.health_record_key = w.id
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
  return workouts.filter((w) => !w.sessionId && LABELABLE_TYPES.has(w.type));
}

export type WorkoutSessionInput = {
  date: string;
  rawText: string;
  name: string;
  workoutType: WorkoutType;
  muscleGroups: MuscleName[];
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
      match_status, health_record_key, linked_by, time_hint_start, time_hint_end, raw_text, notes
    )
    values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::time, $12::time, $13, $14)
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
      input.notes || null
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

// The last date each muscle group was trained, on or before endDate, over the
// past year: from logged sessions (a specific muscle counts for its group),
// plus unlabeled Fitbit runs and rides as Cardio.
export async function lastTrainedByMuscle(db: Pick<Pool, "query">, userName: string, endDate: string) {
  const { rows } = await db.query<{ muscle: MuscleName; day: string }>(
    `
    select muscle, max(day)::text as "day"
    from (
      select unnest(muscle_groups) as muscle, entry_date as day
      from public.workout_sessions
      where user_name = $1 and entry_date <= $2::date and entry_date > $2::date - 365
      union all
      select 'Cardio', w.day
      from public.health_workouts w
      where w.user_name = $1 and w.day <= $2::date and w.day > $2::date - 365
        and w.type = any($3)
        and not exists (
          select 1 from public.workout_sessions s
          where s.user_name = w.user_name and s.health_record_key = w.id
        )
    ) trained
    group by muscle
    `,
    [userName, endDate, CARDIO_FITBIT_TYPES]
  );
  const byGroup = new Map<MuscleGroup, string>();
  for (const row of rows) {
    const group = groupOf(row.muscle);
    if (!group) continue;
    const current = byGroup.get(group);
    if (!current || row.day > current) byGroup.set(group, row.day);
  }
  return byGroup;
}

export async function updateWorkoutSession(
  db: Pick<Pool, "query">,
  userName: string,
  id: string,
  changes: { name: string; muscleGroups: MuscleName[]; rpe: number | null }
) {
  const { rowCount } = await db.query(
    `
    update public.workout_sessions
    set name = $3, muscle_groups = $4, rpe = $5
    where id = $1 and user_name = $2
    `,
    [id, userName, changes.name, changes.muscleGroups, changes.rpe]
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
