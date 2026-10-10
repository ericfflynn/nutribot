// Logged workouts (workout_sessions) and how they're matched to Fitbit
// workouts (health_workouts). Matching is deterministic code; the chat brain
// only supplies the clues: type, date, an optional time window.
import type { Pool } from "pg";

export const MUSCLE_GROUPS = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Legs", "Abs", "Cardio"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const WORKOUT_TYPES = ["strength", "run", "walk", "ride", "sport", "class", "other"] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

// Fitbit exercise types each logged type can match. "other" matches anything
// except walks, which are mostly auto-detected.
const FITBIT_TYPES: Record<Exclude<WorkoutType, "other">, string[]> = {
  strength: ["WEIGHTLIFTING", "WEIGHTS", "CORE_TRAINING", "AEROBIC_WORKOUT"],
  run: ["RUNNING", "TREADMILL"],
  walk: ["WALKING", "HIKING"],
  ride: ["BIKING", "SPINNING"],
  sport: ["TENNIS", "GOLF", "SPORT"],
  class: ["PILATES", "YOGA", "AEROBIC_WORKOUT"]
};

// Fitbit workouts worth labeling when nothing is logged for them.
const LABELABLE_TYPES = new Set(Object.values(FITBIT_TYPES).flat().filter((type) => type !== "WALKING"));

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
      s.id::text as "sessionId"
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

// Fitbit workouts nothing has been logged for, excluding walks.
export async function listUnlabeledWorkouts(db: Pool, userName: string, startDate: string, endDate: string) {
  const workouts = await listFitbitWorkouts(db, userName, startDate, endDate);
  return workouts.filter((w) => !w.sessionId && LABELABLE_TYPES.has(w.type));
}

export type WorkoutSessionInput = {
  date: string;
  rawText: string;
  name: string;
  workoutType: WorkoutType;
  muscleGroups: MuscleGroup[];
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
